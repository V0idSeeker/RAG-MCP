// debug-upsert.js — sends a minimal upsert directly to ChromaDB to see the real 422 message
import { config as dotenvConfig } from "dotenv";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import path from "path";
import { embedText } from "./src/embedder.js";

const require   = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envFile   = [process.cwd(), __dirname].map(p => path.join(p, ".env"))
  .find(p => { try { require("fs").accessSync(p); return true; } catch { return false; } });
if (envFile) dotenvConfig({ path: envFile });

const CHROMA_URL = process.env.CHROMA_URL || "http://localhost:8000";
const COL_NAME   = process.argv[2] || "debug-test-col";

console.log(`\nChromaDB: ${CHROMA_URL}`);
console.log(`Collection: ${COL_NAME}\n`);

// Step 1: get or create collection via raw API
const createRes = await fetch(`${CHROMA_URL}/api/v2/tenants/default_tenant/databases/default_database/collections`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ name: COL_NAME, metadata: { "hnsw:space": "cosine" } })
});
const createBody = await createRes.text();
console.log(`Create status: ${createRes.status}`);
console.log(`Create body: ${createBody}\n`);

let colId;
try { colId = JSON.parse(createBody).id; } catch {}

if (!colId) {
  // Try fetching existing
  const getRes  = await fetch(`${CHROMA_URL}/api/v2/tenants/default_tenant/databases/default_database/collections/${encodeURIComponent(COL_NAME)}`);
  const getBody = await getRes.text();
  console.log(`Get status: ${getRes.status}`);
  console.log(`Get body: ${getBody}\n`);
  try { colId = JSON.parse(getBody).id; } catch {}
}

if (!colId) { console.error("Could not get collection ID, aborting"); process.exit(1); }
console.log(`Collection ID: ${colId}\n`);

// Step 2: generate one real embedding
console.log("Generating test embedding...");
const emb = await embedText("This is a test document for debugging purposes.");
console.log(`Embedding dim: ${emb.length}, first 3 values: ${emb.slice(0,3)}\n`);

// Check for NaN/Infinity
const hasNaN = emb.some(v => isNaN(v) || !isFinite(v));
console.log(`Has NaN/Inf: ${hasNaN}`);
if (hasNaN) {
  const badIndices = emb.map((v,i) => (!isFinite(v)||isNaN(v))?i:-1).filter(i=>i>=0);
  console.log(`Bad indices: ${badIndices.slice(0,10)}`);
}

// Step 3: raw upsert
console.log("\nSending raw upsert...");
const upsertPayload = {
  ids:        ["debug::chunk::0"],
  embeddings: [emb],
  documents:  ["This is a test document for debugging purposes."],
  metadatas:  [{ source: "debug.pdf", chunkIndex: 0 }]
};
const upsertRes  = await fetch(`${CHROMA_URL}/api/v2/tenants/default_tenant/databases/default_database/collections/${colId}/upsert`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(upsertPayload)
});
const upsertBody = await upsertRes.text();
console.log(`Upsert status: ${upsertRes.status}`);
console.log(`Upsert body: ${upsertBody}`);

// Cleanup
await fetch(`${CHROMA_URL}/api/v2/tenants/default_tenant/databases/default_database/collections/${colId}`, { method: "DELETE" });
console.log("\nCleaned up debug collection.");