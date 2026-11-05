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
const LLAMACPP_URL      = process.env.LLAMACPP_URL      || "http://localhost:8080/v1";

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

/** semantic search with minimum score threshold - returns ALL results above the threshold */
async function searchContextByScore({ query, min_score = 0.7, collection, source_filter, max_results = 1000 }) {
  const col = await getCollection(collection);
  const embedding = await embedText(query);

  const where = source_filter ? { source: { $contains: source_filter } } : undefined;

  // Query with a large number to get many results, then filter by score
  const results = await col.query({
    queryEmbeddings: [embedding],
    nResults: max_results,
    where,
    include: ["documents", "metadatas", "distances"],
  });

  const items = results.ids[0]
    .map((id, i) => ({
      id,
      text: results.documents[0][i],
      source: results.metadatas[0][i]?.source,
      chunkIndex: results.metadatas[0][i]?.chunkIndex,
      score: +(1 - results.distances[0][i]).toFixed(4), // cosine similarity
    }))
    .filter(item => item.score >= min_score)
    .sort((a, b) => b.score - a.score); // Sort by score descending

  return {
    query,
    min_score,
    results: items,
    total_found: items.length,
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

// ── RLM Reasoning Engine ──────────────────────────────────

/** Call llama.cpp chat completions API */
async function llmCall(messages) {
  const res = await fetch(`${LLAMACPP_URL}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "qwen-8b",
      messages,
      max_tokens: 1024,
      temperature: 0.2,
    }),
  });
  const data = await res.json();
  return data.choices[0].message.content.trim();
}

/** Multi-pass recursive reasoning over PDF chunks */
async function rlmReason({ query, collection, min_score = 0.70, max_iterations = 3 }) {
  // Initial retrieval using search_pdf_context_by_score
  const initialSearch = await searchContextByScore({ 
    query, 
    min_score, 
    collection 
  });
  
  let selectedChunks = initialSearch.results;
  
  if (!selectedChunks || selectedChunks.length === 0) {
    return {
      error: "No relevant context found for this query.",
      query,
      min_score,
    };
  }

  let iteration = 0;

  while (iteration < max_iterations) {
    iteration++;

    // ── Pass 1: Is the context sufficient? ──────────────────────────────
    const pass1 = await llmCall([
      {
        role: "system",
        content: `You are a research assistant. Analyze if the provided context chunks are sufficient to fully answer the query. 
If sufficient, respond with exactly: SUFFICIENT
If not, respond with exactly: NEED: <what is missing> | SEARCH: <refined search query>`,
      },
      {
        role: "user",
        content: `Query: ${query}\n\nContext chunks:\n${selectedChunks
          .map((c, i) => `[${i}] (${c.source}, score: ${c.score.toFixed(2)})\n${c.text}`)
          .join("\n\n")}`,
      },
    ]);

    // If sufficient or last iteration, move to final answer
    if (pass1.startsWith("SUFFICIENT") || iteration === max_iterations) break;

    // ── If more context needed, refine the search ────────────────────────
    const searchMatch = pass1.match(/SEARCH:\s*(.+)/);
    if (searchMatch) {
      const refinedQuery = searchMatch[1].trim();
      const extraSearch = await searchContextByScore({ 
        query: refinedQuery, 
        min_score: Math.max(0.65, min_score - 0.05), 
        collection 
      });
      
      // Merge, deduplicate by text
      const seen = new Set(selectedChunks.map((c) => c.text));
      for (const c of extraSearch.results) {
        if (!seen.has(c.text)) selectedChunks.push(c);
      }
    }
  }

  // ── Pass 2: Select only the truly needed chunks ──────────────────────────
  const pass2 = await llmCall([
    {
      role: "system",
      content: `You are a research assistant. From the provided chunks, return ONLY a JSON array of indices (e.g. [0, 2, 5]) of chunks that directly help answer the query. Return ONLY the JSON array, nothing else.`,
    },
    {
      role: "user",
      content: `Query: ${query}\n\nChunks:\n${selectedChunks
        .map((c, i) => `[${i}] (${c.source})\n${c.text}`)
        .join("\n\n")}`,
    },
  ]);

  let usedChunks = selectedChunks;
  try {
    const indices = JSON.parse(pass2);
    usedChunks = indices.map((i) => selectedChunks[i]).filter(Boolean);
  } catch {
    // If parsing fails, use all chunks
  }

  // ── Pass 3: Generate the final complete answer ───────────────────────────
  const pass3 = await llmCall([
    {
      role: "system",
      content: `You are a research assistant. Using ONLY the provided context chunks, write a complete, detailed, self-contained answer. Cite the source PDF filename for every claim you make.`,
    },
    {
      role: "user",
      content: `Query: ${query}\n\nContext:\n${usedChunks
        .map((c) => `[${c.source}]\n${c.text}`)
        .join("\n\n")}`,
    },
  ]);

  return {
    answer: pass3,
    sources: [...new Set(usedChunks.map((c) => c.source))],
    chunks_used: usedChunks.length,
    chunks_retrieved: selectedChunks.length,
    iterations: iteration,
  };
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
    name: "search_pdf_context_by_score",
    description:
      "Semantically search across all ingested PDF documents and return ALL text chunks above a minimum similarity score threshold. Unlike the regular search which returns a fixed number of top results, this returns all results that meet the score criteria, making it useful for comprehensive context gathering.",
    inputSchema: {
      type: "object",
      properties: {
        query:         { type: "string",  description: "Natural language search query" },
        min_score:     { type: "number",  description: "Minimum similarity score threshold (0.0-1.0, default 0.7). Higher values = more relevant results." },
        collection:    { type: "string",  description: "ChromaDB collection name (optional)" },
        source_filter: { type: "string",  description: "Filter by PDF filename (partial match, optional)" },
        max_results:   { type: "number",  description: "Maximum number of results to consider before filtering (default 1000)" },
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
  {
    name: "rlm_reason",
    description:
      "Recursively reasons over PDF context to produce a complete, sourced answer. Unlike search tools that return raw chunks, this tool determines exactly what information is needed and returns a fully reasoned response using a multi-pass reasoning loop with a local LLM.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "The question or task to reason over",
        },
        collection: {
          type: "string",
          description: "ChromaDB collection name (optional, defaults to CHROMA_COLLECTION env var)",
        },
        min_score: {
          type: "number",
          description: "Minimum similarity score for chunk retrieval (optional, default 0.70)",
        },
        max_iterations: {
          type: "number",
          description: "Max recursive reasoning iterations (optional, default 3)",
        },
      },
      required: ["query"],
    },
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
      case "search_pdf_context":          result = await searchContext(args);        break;
      case "search_pdf_context_by_score": result = await searchContextByScore(args); break;
      case "list_pdf_sources":            result = await listSources(args);          break;
      case "get_pdf_document":            result = await getDocument(args);          break;
      case "delete_pdf_document":         result = await deleteDocument(args);       break;
      case "list_collections":            result = await listCollections();          break;
      case "rlm_reason":                  result = await rlmReason(args);            break;
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
