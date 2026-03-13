#!/usr/bin/env node
// delete-collection.js
// Usage: node delete-collection.js <collection-name>
//        node delete-collection.js --list

import { ChromaClient } from "chromadb";
import { config as dotenvConfig } from "dotenv";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import path from "path";

const require   = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const envPaths = [
  path.join(process.cwd(), ".env"),
  path.join(__dirname, ".env"),
];
const envFile = envPaths.find(p => { try { require("fs").accessSync(p); return true; } catch { return false; } });
if (envFile) dotenvConfig({ path: envFile });

const CHROMA_URL = process.env.CHROMA_URL || "http://localhost:8000";
const args       = process.argv.slice(2);

if (!args.length) {
  console.log("Usage:");
  console.log("  node delete-collection.js <collection-name>   Delete a collection");
  console.log("  node delete-collection.js --list              List all collections");
  process.exit(0);
}

const client = new ChromaClient({ path: CHROMA_URL });

if (args[0] === "--list") {
  const cols = await client.listCollections();
  if (!cols.length) { console.log("No collections found."); process.exit(0); }
  console.log("\nCollections:");
  for (const c of cols) {
    const name  = typeof c === "string" ? c : c.name;
    try {
      const col   = await client.getCollection({ name });
      const count = await col.count();
      console.log(`  • ${name}  (${count.toLocaleString()} chunks)`);
    } catch { console.log(`  • ${name}`); }
  }
  console.log();
  process.exit(0);
}

const target = args[0];

// Confirm the collection exists first
let exists = false;
try {
  await client.getCollection({ name: target });
  exists = true;
} catch { exists = false; }

if (!exists) {
  console.error(`Collection "${target}" not found.`);
  process.exit(1);
}

// Ask for confirmation unless --force is passed
if (!args.includes("--force")) {
  const { createInterface } = await import("readline");
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise(r => rl.question(`Delete collection "${target}"? This cannot be undone. [y/N] `, r));
  rl.close();
  if (answer.trim().toLowerCase() !== "y") {
    console.log("Aborted.");
    process.exit(0);
  }
}

await client.deleteCollection({ name: target });
console.log(`✅ Collection "${target}" deleted.`);
