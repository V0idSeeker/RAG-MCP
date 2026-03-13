#!/usr/bin/env node
// ui-server.js — serves ui/ as static files + JSON API routes
import http   from "http";
import fs     from "fs";
import path   from "path";
import { spawn, exec } from "child_process";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Load .env ─────────────────────────────────────────────
const envFile = [__dirname, path.join(__dirname, "..")].map(d => path.join(d, ".env")).find(f => fs.existsSync(f));
if (envFile) {
  try { const { config } = await import("dotenv"); config({ path: envFile }); console.log(`[UI] .env loaded: ${envFile}`); }
  catch { /* dotenv optional */ }
}

const PORT           = parseInt(process.env.UI_PORT           || "3131");
const CHROMA_URL     = process.env.CHROMA_URL                 || "http://localhost:8000";
const DEF_COLLECTION = process.env.CHROMA_COLLECTION          || "pdf_context";
const UI_DIR         = path.join(__dirname, "ui");
const INGEST_JS      = path.join(__dirname, "src", "ingest.js");

const MIME = { ".html":"text/html", ".css":"text/css", ".js":"application/javascript", ".json":"application/json", ".ico":"image/x-icon" };
const CORS = { "Access-Control-Allow-Origin":"*", "Access-Control-Allow-Headers":"Content-Type", "Access-Control-Allow-Methods":"GET,POST,DELETE,OPTIONS" };

function reply(res, status, ct, body) { res.writeHead(status, { "Content-Type": ct, ...CORS }); res.end(body); }
function replyJSON(res, status, obj) { reply(res, status, "application/json", JSON.stringify(obj)); }
function parseBody(req) { return new Promise(ok => { let b=""; req.on("data",d=>b+=d); req.on("end",()=>{ try{ok(JSON.parse(b))}catch{ok({})} }); }); }
function qs(u) { return Object.fromEntries(new URL(u, "http://x").searchParams); }
async function chromaFetch(p, opts={}) { return fetch(`${CHROMA_URL.replace(/\/$/,"")}/api/v2/tenants/default_tenant/databases/default_database${p}`, opts); }

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x").pathname;
  if (req.method === "OPTIONS") return reply(res, 204, "text/plain", "");

  // config
  if (req.method === "GET" && url === "/api/config")
    return replyJSON(res, 200, { chromaUrl: CHROMA_URL, defaultCollection: DEF_COLLECTION, port: PORT });

  // list collections
  if (req.method === "GET" && url === "/api/collections") {
    try {
      const r = await chromaFetch("/collections?limit=100");
      if (!r.ok) return replyJSON(res, 500, { error: `ChromaDB ${r.status}` });
      const body = await r.json();
      const cols = Array.isArray(body) ? body : (body.collections || body.results || []);
      const out  = await Promise.all(cols.map(async c => {
        const name = typeof c === "string" ? c : c.name;
        const id   = c.id || null;
        try {
          const cr  = await chromaFetch(`/collections/${id||encodeURIComponent(name)}/count`);
          const raw = cr.ok ? await cr.json() : 0;
          return { name, count: typeof raw === "number" ? raw : (raw?.count ?? 0) };
        } catch { return { name, count: 0 }; }
      }));
      return replyJSON(res, 200, out);
    } catch(e) { return replyJSON(res, 500, { error: e.message }); }
  }

  // delete collection
  if (req.method === "DELETE" && url.startsWith("/api/collections/")) {
    const name = decodeURIComponent(url.replace("/api/collections/", ""));
    try {
      const r = await chromaFetch(`/collections/${encodeURIComponent(name)}`, { method: "DELETE" });
      if (!r.ok) return replyJSON(res, 500, { error: await r.text() });
      return replyJSON(res, 200, { deleted: name });
    } catch(e) { return replyJSON(res, 500, { error: e.message }); }
  }

  // ingest SSE
  if (req.method === "GET" && url === "/api/ingest") {
    const { folder: raw, collection } = qs(req.url);
    if (!raw || !collection) return reply(res, 400, "text/plain", "missing params");
    const folder = raw.replace(/^["']+|["']+$/g, "").trim();
    res.writeHead(200, { "Content-Type":"text/event-stream", "Cache-Control":"no-cache", "Connection":"keep-alive", ...CORS });
    const send = (type, msg) => res.write(`data: ${JSON.stringify({ type, message: msg })}\n\n`);
    const child = spawn("node", [INGEST_JS, folder, "--collection", collection], { cwd: __dirname, env: { ...process.env, CHROMA_URL, CHROMA_COLLECTION: collection } });
    child.stdout.on("data", d => d.toString().split("\n").filter(Boolean).forEach(line => {
      if      (line.includes("Found") && line.includes("PDF")) send("info",       line.trim());
      else if (line.includes("📄 Processing:"))                 send("file",       line.replace("📄 Processing:","").trim());
      else if (line.includes("→") && line.includes("chunk"))   send("chunks",     line.trim());
      else if (line.includes("✅ Done:"))                       send("done_file",  line.replace("✅ Done:","").trim());
      else if (line.includes("❌ Failed:"))                     send("error_file", line.replace("❌ Failed:","").trim());
      else if (line.includes("🎉 Ingestion complete"))          send("complete",   line.trim());
      else if (line.trim())                                     send("log",        line.trim());
    }));
    child.stderr.on("data", d => d.toString().split("\n").filter(Boolean).forEach(line => {
      const m = line.trim();
      if (!m || m.startsWith("Warning:") || m.includes("session_state")) return;
      if (m.startsWith("[Embedder]")) send("embedder", m.replace("[Embedder]","").trim());
      else if (m.includes("Error:") || m.includes("Cannot find")) send("error_file", m);
      else send("log", m);
    }));
    child.on("close", code => { if(code!==0) send("error_file",`Exit code ${code}`); send("exit",String(code)); res.end(); });
    req.on("close", () => child.kill());
    return;
  }

  // search
  if (req.method === "POST" && url === "/api/search") {
    const { query, collection, n_results = 5 } = await parseBody(req);
    if (!query || !collection) return replyJSON(res, 400, { error: "query and collection required" });
    const child = spawn("node", ["--input-type=module"], { cwd: __dirname, env: { ...process.env, CHROMA_URL } });
    const script = `
import { embedText } from './src/embedder.js';
import { ChromaClient } from 'chromadb';
const chroma = new ChromaClient({ path: '${CHROMA_URL}' });
const col = await chroma.getCollection({ name: ${JSON.stringify(collection)} });
const emb = await embedText(${JSON.stringify(query)}, 'query');
const r   = await col.query({ queryEmbeddings: [emb], nResults: ${Number(n_results)}, include: ['documents','metadatas','distances'] });
const out = r.ids[0].map((id,i) => ({ id, text: r.documents[0][i], source: r.metadatas[0][i]?.source||'unknown', chunkIndex: r.metadatas[0][i]?.chunkIndex, score: parseFloat((1-r.distances[0][i]).toFixed(4)) }));
process.stdout.write(JSON.stringify({ results: out }));`;
    let out="", err="";
    child.stdin.write(script); child.stdin.end();
    child.stdout.on("data", d => out+=d);
    child.stderr.on("data", d => err+=d);
    child.on("close", code => {
      try { replyJSON(res, 200, JSON.parse(out)); }
      catch { replyJSON(res, 500, { error: err.split("\n").find(l=>l.includes("Error:")||l.includes("Cannot find"))||`Exit ${code}`, detail: err }); }
    });
    return;
  }

  // static files from ui/
  let fp = path.join(UI_DIR, url === "/" ? "index.html" : url);
  if (!fs.existsSync(fp)) fp = path.join(UI_DIR, "index.html");
  try {
    reply(res, 200, MIME[path.extname(fp)]||"application/octet-stream", fs.readFileSync(fp));
  } catch { replyJSON(res, 404, { error: "Not found" }); }
});

server.listen(PORT, () => {
  const base = `http://localhost:${PORT}`;
  console.log(`\n  📚  DocMCP UI  →  ${base}\n  ChromaDB      →  ${CHROMA_URL}\n`);
  const open = process.platform==="win32"?"start":process.platform==="darwin"?"open":"xdg-open";
  exec(`${open} ${base}`);
});
