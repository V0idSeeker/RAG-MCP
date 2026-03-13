#!/usr/bin/env node
// src/index.js  —  PDF Context MCP Server
// Exposes tools that Kiro (or any MCP client) can call to retrieve PDF context

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { ChromaClient } from "chromadb";
import { embedText } from "./embedder.js";

// ── Config ────────────────────────────────────────────────
const CHROMA_URL        = process.env.CHROMA_URL        || "http://localhost:8000";
const CHROMA_COLLECTION = process.env.CHROMA_COLLECTION || "pdf_context";
const DEFAULT_RESULTS   = 5;

// ── ChromaDB client ───────────────────────────────────────
const chroma = new ChromaClient({ path: CHROMA_URL });

async function getCollection(name = CHROMA_COLLECTION) {
  try {
    return await chroma.getCollection({ name });
  } catch {
    throw new Error(
      `Collection "${name}" not found. Run: node src/ingest.js <folder> first.`
    );
  }
}

// ── Tool handlers ─────────────────────────────────────────

/** semantic search across all ingested PDFs */
async function searchContext({ query, n_results = DEFAULT_RESULTS, collection, source_filter }) {
  const col = await getCollection(collection);
  const embedding = await embedText(query);

  const where = source_filter ? { source: { $contains: source_filter } } : undefined;

  const results = await col.query({
    queryEmbeddings: [embedding],
    nResults: n_results,
    where,
    include: ["documents", "metadatas", "distances"],
  });

  const items = results.ids[0].map((id, i) => ({
    id,
    text: results.documents[0][i],
    source: results.metadatas[0][i]?.source,
    chunkIndex: results.metadatas[0][i]?.chunkIndex,
    score: +(1 - results.distances[0][i]).toFixed(4), // cosine similarity
  }));

  return {
    query,
    results: items,
    collection: collection || CHROMA_COLLECTION,
  };
}

/** list all PDFs that have been ingested */
async function listSources({ collection }) {
  const col = await getCollection(collection);
  const count = await col.count();
  if (count === 0) return { sources: [], total_chunks: 0 };

  // Peek at up to 10 000 items to gather unique source names
  const peek = await col.peek({ limit: Math.min(count, 10000) });
  const sources = [...new Set(peek.metadatas.map((m) => m?.source).filter(Boolean))].sort();

  return { sources, total_chunks: count, collection: collection || CHROMA_COLLECTION };
}

/** get full text of a specific document */
async function getDocument({ source, collection }) {
  const col = await getCollection(collection);
  const results = await col.get({
    where: { source: { $eq: source } },
    include: ["documents", "metadatas"],
  });

  if (!results.ids.length) {
    throw new Error(`No chunks found for source: "${source}"`);
  }

  // Sort by chunkIndex and reassemble
  const chunks = results.ids.map((id, i) => ({
    index: results.metadatas[i]?.chunkIndex ?? i,
    text: results.documents[i],
  }));
  chunks.sort((a, b) => a.index - b.index);

  return {
    source,
    total_chunks: chunks.length,
    full_text: chunks.map((c) => c.text).join(" "),
  };
}

/** delete a specific PDF's chunks from the DB */
async function deleteDocument({ source, collection }) {
  const col = await getCollection(collection);
  const existing = await col.get({ where: { source: { $eq: source } } });
  if (!existing.ids.length) throw new Error(`Source not found: "${source}"`);
  await col.delete({ ids: existing.ids });
  return { deleted: existing.ids.length, source };
}

/** list available collections */
async function listCollections() {
  const cols = await chroma.listCollections();
  return { collections: cols.map((c) => (typeof c === "string" ? c : c.name)) };
}

// ── Tool definitions ──────────────────────────────────────
const TOOLS = [
  {
    name: "search_pdf_context",
    description:
      "Semantically search across all ingested PDF documents and return the most relevant text chunks. Use this to retrieve context from documentation, papers, or any PDF files that have been indexed.",
    inputSchema: {
      type: "object",
      properties: {
        query:         { type: "string",  description: "Natural language search query" },
        n_results:     { type: "number",  description: "Number of results to return (default 5)" },
        collection:    { type: "string",  description: "ChromaDB collection name (optional)" },
        source_filter: { type: "string",  description: "Filter by PDF filename (partial match, optional)" },
      },
      required: ["query"],
    },
  },
  {
    name: "list_pdf_sources",
    description: "List all PDF files that have been ingested into the vector database.",
    inputSchema: {
      type: "object",
      properties: {
        collection: { type: "string", description: "ChromaDB collection name (optional)" },
      },
    },
  },
  {
    name: "get_pdf_document",
    description: "Retrieve the full text content of a specific ingested PDF by its source filename.",
    inputSchema: {
      type: "object",
      properties: {
        source:     { type: "string", description: "The PDF source filename as shown in list_pdf_sources" },
        collection: { type: "string", description: "ChromaDB collection name (optional)" },
      },
      required: ["source"],
    },
  },
  {
    name: "delete_pdf_document",
    description: "Remove a specific PDF's data from the vector database.",
    inputSchema: {
      type: "object",
      properties: {
        source:     { type: "string", description: "The PDF source filename to delete" },
        collection: { type: "string", description: "ChromaDB collection name (optional)" },
      },
      required: ["source"],
    },
  },
  {
    name: "list_collections",
    description: "List all available ChromaDB collections (each can hold a separate PDF corpus).",
    inputSchema: { type: "object", properties: {} },
  },
];

// ── MCP Server ────────────────────────────────────────────
const server = new Server(
  { name: "pdf-context-mcp", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args = {} } = request.params;

  try {
    let result;
    switch (name) {
      case "search_pdf_context": result = await searchContext(args);  break;
      case "list_pdf_sources":   result = await listSources(args);    break;
      case "get_pdf_document":   result = await getDocument(args);    break;
      case "delete_pdf_document":result = await deleteDocument(args); break;
      case "list_collections":   result = await listCollections();    break;
      default: throw new Error(`Unknown tool: ${name}`);
    }

    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  } catch (err) {
    return {
      content: [{ type: "text", text: `Error: ${err.message}` }],
      isError: true,
    };
  }
});

// ── Start ─────────────────────────────────────────────────
const transport = new StdioServerTransport();
await server.connect(transport);
console.error("[PDF MCP] Server running. Waiting for MCP client connections...");
