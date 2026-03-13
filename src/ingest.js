#!/usr/bin/env node
// ingest.js
// Usage: node ingest.js <folder_path> [--collection name] [--reset]
//   --reset: delete and recreate the collection before ingesting

import fs from "fs";
import path from "path";
import { ChromaClient } from "chromadb";
import pdfParse from "pdf-parse";
import { embedBatch, embedText } from "./embedder.js";

const CHROMA_URL         = process.env.CHROMA_URL        || "http://localhost:8000";
const DEFAULT_COLLECTION = process.env.CHROMA_COLLECTION || "pdf_context";
const CHUNK_SIZE         = parseInt(process.env.CHUNK_SIZE    || "800");
const CHUNK_OVERLAP      = parseInt(process.env.CHUNK_OVERLAP || "150");
const EMBEDDING_MODEL    = process.env.EMBEDDING_MODEL   || "unknown";

const MIN_CONTENT_CHARS = 80;
const MIN_WORD_COUNT    = 12;

// ── CLI args ──────────────────────────────────────────────
const args          = process.argv.slice(2);
const folderArg     = args.find((a) => !a.startsWith("--"));
const collectionArg = args[args.indexOf("--collection") + 1] || DEFAULT_COLLECTION;
const doReset       = args.includes("--reset");

if (!folderArg) {
  console.error("Usage: node ingest.js <folder_path> [--collection name] [--reset]");
  process.exit(1);
}

const folder = path.resolve(folderArg);
if (!fs.existsSync(folder)) {
  console.error(`Folder not found: ${folder}`);
  process.exit(1);
}

// ── Text cleaning ─────────────────────────────────────────
function cleanText(raw) {
  return raw
    .replace(/\r\n/g, "\n")
    .replace(/\f/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => {
      const s = line.trim();
      if (!s) return true;
      if (/^\d+$/.test(s)) return false;
      if (/^[-–—=_.*•·|/\\]{2,}$/.test(s)) return false;
      return true;
    })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function isUsefulChunk(chunk) {
  const s = chunk.trim();
  if (s.length < MIN_CONTENT_CHARS) return false;
  if (s.split(/\s+/).filter(Boolean).length < MIN_WORD_COUNT) return false;
  const alphaRatio = (s.match(/[a-zA-ZÀ-ÿ]/g) || []).length / s.length;
  if (alphaRatio < 0.3) return false;
  return true;
}

// ── Chunking ──────────────────────────────────────────────
function chunkText(text, size = CHUNK_SIZE, overlap = CHUNK_OVERLAP) {
  const paragraphs = text.split(/\n\n+/);
  const chunks = [];
  let current = "";

  for (const para of paragraphs) {
    const candidate = current ? current + "\n\n" + para : para;
    if (candidate.length <= size) {
      current = candidate;
    } else {
      if (current) chunks.push(current.trim());
      if (para.length > size) {
        let s = 0;
        while (s < para.length) {
          const end = Math.min(s + size, para.length);
          chunks.push(para.slice(s, end).trim());
          if (end === para.length) break;
          s += size - overlap;
        }
        current = "";
      } else {
        current = para;
      }
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks.filter(isUsefulChunk);
}

async function extractText(pdfPath) {
  const buffer = fs.readFileSync(pdfPath);
  const data   = await pdfParse(buffer);
  return cleanText(data.text);
}

function getPdfFiles(dir) {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) results.push(...getPdfFiles(full));
    else if (entry.name.toLowerCase().endsWith(".pdf")) results.push(full);
  }
  return results;
}

// ── Dimension check ───────────────────────────────────────
async function checkDimension(collection, sampleText) {
  // Get a test embedding to know our current dimension
  const testEmb  = await embedText(sampleText);
  const ourDim   = testEmb.length;

  // Check if collection already has data with a different dimension
  const existing = await collection.peek({ limit: 1 });
  if (existing.embeddings && existing.embeddings.length > 0) {
    const storedDim = existing.embeddings[0].length;
    if (storedDim !== ourDim) {
      throw new Error(
        `Dimension mismatch! Collection has ${storedDim}-dim embeddings but current model produces ${ourDim}-dim.\n` +
        `  → Run with --reset to delete and recreate the collection, or use the same model that created it.\n` +
        `  → Collection was likely created with a different EMBEDDING_MODEL.`
      );
    }
  }
  return ourDim;
}

// ── Main ──────────────────────────────────────────────────
async function main() {
  const client = new ChromaClient({ path: CHROMA_URL });

  // --reset: wipe the collection before ingesting
  if (doReset) {
    try {
      await client.deleteCollection({ name: collectionArg });
      console.log(`🗑  Deleted existing collection "${collectionArg}"`);
    } catch {
      // didn't exist — that's fine
    }
  }

  const collection = await client.getOrCreateCollection({
    name: collectionArg,
    metadata: {
      "hnsw:space":      "cosine",
      "embedding_model": EMBEDDING_MODEL,
    },
  });

  const pdfFiles = getPdfFiles(folder);
  console.log(`\nFound ${pdfFiles.length} PDF(s) in ${folder}`);

  let totalChunks   = 0;
  let dimChecked    = false;

  for (const pdfPath of pdfFiles) {
    const filename = path.relative(folder, pdfPath);
    console.log(`\n📄 Processing: ${filename}`);

    try {
      const raw    = await extractText(pdfPath);
      const chunks = chunkText(raw);
      console.log(`   → ${chunks.length} chunks`);

      if (chunks.length === 0) {
        console.log(`   ⚠️  Skipped: no usable content extracted`);
        continue;
      }

      // Check dimension once before first upsert — fail fast with clear message
      if (!dimChecked) {
        const dim = await checkDimension(collection, chunks[0]);
        console.log(`   ✓ Embedding dimension: ${dim}`);
        dimChecked = true;
      }

      const BATCH = 32;
      for (let i = 0; i < chunks.length; i += BATCH) {
        const batch      = chunks.slice(i, i + BATCH);
        const embeddings = await embedBatch(batch);

        const ids       = batch.map((_, j) => `${filename}::chunk::${i + j}`);
        const metadatas = batch.map((_, j) => ({
          source:          filename,
          fullPath:        pdfPath,
          chunkIndex:      i + j,
          totalChunks:     chunks.length,
          embedding_model: EMBEDDING_MODEL,
        }));

        try {
          await collection.upsert({ ids, embeddings, documents: batch, metadatas });
        } catch (upsertErr) {
          // Try to extract the actual ChromaDB error detail
          const detail = upsertErr.message || String(upsertErr);
          // Log the first embedding shape to diagnose
          if (i === 0) {
            console.error(`   [DEBUG] embeddings[0] length: ${embeddings[0]?.length}`);
            console.error(`   [DEBUG] embeddings type: ${typeof embeddings[0][0]}`);
            console.error(`   [DEBUG] ids[0]: ${ids[0]}`);
            console.error(`   [DEBUG] doc[0] length: ${batch[0]?.length}`);
          }
          throw upsertErr;
        }
        process.stdout.write(`   ✓ ${Math.min(i + BATCH, chunks.length)}/${chunks.length} chunks stored\r`);
      }

      totalChunks += chunks.length;
      console.log(`   ✅ Done: ${filename}                    `);
    } catch (err) {
      // If it's a dimension mismatch, abort entirely — no point continuing
      if (err.message.includes("Dimension mismatch")) {
        console.error(`\n❌ ${err.message}`);
        process.exit(1);
      }
      console.error(`   ❌ Failed: ${filename} — ${err.message}`);
    }
  }

  console.log(`\n🎉 Ingestion complete! ${totalChunks} chunks from ${pdfFiles.length} PDFs stored in "${collectionArg}"`);
}

main().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
