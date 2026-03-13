// embedder.js
import { fileURLToPath } from "url";
import path from "path";
import { config as dotenvConfig } from "dotenv";
import { createRequire } from "module";

const require    = createRequire(import.meta.url);
const __dirname  = path.dirname(fileURLToPath(import.meta.url));

// Search for .env in cwd first, then next to this file, then one level up
const envPaths = [
  path.join(process.cwd(), ".env"),
  path.join(__dirname, ".env"),
  path.join(__dirname, "..", ".env"),
];
const envFile   = envPaths.find(p => { try { require("fs").accessSync(p); return true; } catch { return false; } });
const envResult = envFile
  ? dotenvConfig({ path: envFile })
  : { error: new Error("No .env found in: " + envPaths.join(", ")) };

if (envResult.error) {
  console.error("[Embedder] Warning: could not load .env:", envResult.error.message);
} else {
  console.error("[Embedder] .env loaded from:", envFile);
}

const MODEL_NAME = process.env.EMBEDDING_MODEL || "Xenova/paraphrase-multilingual-MiniLM-L12-v2";
const HF_TOKEN   = process.env.HF_TOKEN        || null;

// Whether this model uses task-specific prefixes (EmbeddingGemma style)
// Detectable by model name containing "embeddinggemma" or "embedding-gemma"
const USE_PREFIXES = /embeddinggemma|embedding-gemma/i.test(MODEL_NAME);
const PREFIX_DOC   = "title: none | text: ";
const PREFIX_QUERY = "task: search result | query: ";

console.error(`[Embedder] Model       : ${MODEL_NAME}`);
console.error(`[Embedder] HF_TOKEN    : ${HF_TOKEN ? HF_TOKEN.slice(0, 8) + "..." : "not set"}`);
console.error(`[Embedder] Prefixes    : ${USE_PREFIXES ? "enabled (EmbeddingGemma mode)" : "disabled"}`);

let pipeline    = null;
let initPromise = null;

export async function getEmbedder() {
  if (pipeline) return pipeline;
  if (!initPromise) {
    initPromise = (async () => {
      const transformers = await import("@huggingface/transformers");
      const env = transformers.env;

      env.allowRemoteModels = true;
      env.allowLocalModels  = true;
      env.useBrowserCache   = false;
      if (HF_TOKEN) env.authToken = HF_TOKEN;

      // Use GPU if available (requires onnxruntime-node with CUDA/DML support)
      // Falls back to CPU automatically if GPU is not available
      const DEVICE = process.env.EMBEDDING_DEVICE || "auto";
      const DTYPE  = process.env.EMBEDDING_DTYPE  || "fp16";

      console.error(`[Embedder] Loading model: ${MODEL_NAME} ...`);
      console.error(`[Embedder] Device: ${DEVICE} | dtype: ${DTYPE}`);
      pipeline = await transformers.pipeline("feature-extraction", MODEL_NAME, {
        revision: "main",
        device: DEVICE,
        dtype:  DTYPE,
      });
      console.error("[Embedder] Model ready.");
    })();
  }
  await initPromise;
  return pipeline;
}

// Embed a single document chunk (uses document prefix if applicable)
export async function embedText(text, type = "document") {
  const embedder = await getEmbedder();
  const input    = USE_PREFIXES
    ? (type === "query" ? PREFIX_QUERY : PREFIX_DOC) + text
    : text;
  const out = await embedder(input, { pooling: "mean", normalize: true });
  return Array.from(out.data);
}

// Embed a batch of document chunks sequentially
export async function embedBatch(texts, type = "document") {
  const embedder = await getEmbedder();
  const results  = [];
  for (const text of texts) {
    const input = USE_PREFIXES
      ? (type === "query" ? PREFIX_QUERY : PREFIX_DOC) + text
      : text;
    const out = await embedder(input, { pooling: "mean", normalize: true });
    results.push(Array.from(out.data));
  }
  return results;
}
