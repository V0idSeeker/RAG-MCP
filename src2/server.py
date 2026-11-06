#!/usr/bin/env python3
"""
PDF Context MCP Server - Python Implementation
Exposes tools that Kiro (or any MCP client) can call to retrieve PDF context
"""
import os
import sys
import json
import asyncio
from typing import Any, Dict, List, Optional
import chromadb
from mcp.server import Server
from mcp.server.stdio import stdio_server
from mcp.types import Tool, TextContent
from dotenv import load_dotenv
from embedder import embed_text

# Import RLM library (official: https://github.com/alexzhang13/rlm, PyPI "rlms", Python >= 3.11)
try:
    from rlm import RLM
    RLM_AVAILABLE = True
except ImportError:
    RLM_AVAILABLE = False
    print("[Warning] RLM library not installed. rlm_reason tool will not be available.", file=sys.stderr)
    print("[Warning] Install with: pip install rlms", file=sys.stderr)

# Load environment variables
load_dotenv()

# Configuration
CHROMA_URL = os.getenv("CHROMA_URL", "http://localhost:8000")
CHROMA_COLLECTION = os.getenv("CHROMA_COLLECTION", "pdf_context")
DEFAULT_RESULTS = 5
LLAMACPP_URL = os.getenv("LLAMACPP_URL", "http://localhost:8080/v1")  # any OpenAI-compatible endpoint (llama.cpp, Ollama /v1)
LLM_MODEL = os.getenv("LLM_MODEL", "qwen-8b")
RLM_VERBOSE = os.getenv("RLM_VERBOSE", "0") == "1"

# ChromaDB client
chroma_host = CHROMA_URL.replace("http://", "").split(":")[0]
chroma_port = int(CHROMA_URL.split(":")[-1])
chroma = chromadb.HttpClient(host=chroma_host, port=chroma_port)


def get_collection(name: str = CHROMA_COLLECTION):
    """Get a ChromaDB collection"""
    try:
        return chroma.get_collection(name=name)
    except Exception:
        raise ValueError(
            f'Collection "{name}" not found. Run: python src2/ingest.py <folder> first.'
        )


# ── Tool handlers ─────────────────────────────────────────

async def search_context(
    query: str,
    n_results: int = DEFAULT_RESULTS,
    collection: Optional[str] = None,
    source_filter: Optional[str] = None
) -> Dict[str, Any]:
    """Semantic search across all ingested PDFs"""
    col = get_collection(collection or CHROMA_COLLECTION)
    embedding = embed_text(query, text_type="query")
    
    where = {"source": {"$contains": source_filter}} if source_filter else None
    
    results = col.query(
        query_embeddings=[embedding],
        n_results=n_results,
        where=where,
        include=["documents", "metadatas", "distances"]
    )
    
    items = []
    for i, doc_id in enumerate(results["ids"][0]):
        items.append({
            "id": doc_id,
            "text": results["documents"][0][i],
            "source": results["metadatas"][0][i].get("source"),
            "chunkIndex": results["metadatas"][0][i].get("chunkIndex"),
            "score": round(1 - results["distances"][0][i], 4)
        })
    
    return {
        "query": query,
        "results": items,
        "collection": collection or CHROMA_COLLECTION
    }


async def search_context_by_score(
    query: str,
    min_score: float = 0.7,
    collection: Optional[str] = None,
    source_filter: Optional[str] = None,
    max_results: int = 1000
) -> Dict[str, Any]:
    """Semantic search with minimum score threshold - returns ALL results above threshold"""
    col = get_collection(collection or CHROMA_COLLECTION)
    embedding = embed_text(query, text_type="query")
    
    where = {"source": {"$contains": source_filter}} if source_filter else None
    
    results = col.query(
        query_embeddings=[embedding],
        n_results=max_results,
        where=where,
        include=["documents", "metadatas", "distances"]
    )
    
    items = []
    for i, doc_id in enumerate(results["ids"][0]):
        score = round(1 - results["distances"][0][i], 4)
        if score >= min_score:
            items.append({
                "id": doc_id,
                "text": results["documents"][0][i],
                "source": results["metadatas"][0][i].get("source"),
                "chunkIndex": results["metadatas"][0][i].get("chunkIndex"),
                "score": score
            })
    
    # Sort by score descending
    items.sort(key=lambda x: x["score"], reverse=True)
    
    return {
        "query": query,
        "min_score": min_score,
        "results": items,
        "total_found": len(items),
        "collection": collection or CHROMA_COLLECTION
    }


async def list_sources(collection: Optional[str] = None) -> Dict[str, Any]:
    """List all PDFs that have been ingested"""
    col = get_collection(collection or CHROMA_COLLECTION)
    count = col.count()
    
    if count == 0:
        return {"sources": [], "total_chunks": 0}
    
    # Peek at items to gather unique source names
    peek = col.peek(limit=min(count, 10000))
    sources = sorted(set(m.get("source") for m in peek["metadatas"] if m.get("source")))
    
    return {
        "sources": sources,
        "total_chunks": count,
        "collection": collection or CHROMA_COLLECTION
    }


async def get_document(source: str, collection: Optional[str] = None) -> Dict[str, Any]:
    """Get full text of a specific document"""
    col = get_collection(collection or CHROMA_COLLECTION)
    
    results = col.get(
        where={"source": {"$eq": source}},
        include=["documents", "metadatas"]
    )
    
    if not results["ids"]:
        raise ValueError(f'No chunks found for source: "{source}"')
    
    # Sort by chunkIndex and reassemble
    chunks = []
    for i, doc_id in enumerate(results["ids"]):
        chunks.append({
            "index": results["metadatas"][i].get("chunkIndex", i),
            "text": results["documents"][i]
        })
    
    chunks.sort(key=lambda x: x["index"])
    full_text = " ".join(c["text"] for c in chunks)
    
    return {
        "source": source,
        "total_chunks": len(chunks),
        "full_text": full_text
    }


async def delete_document(source: str, collection: Optional[str] = None) -> Dict[str, Any]:
    """Delete a specific PDF's chunks from the DB"""
    col = get_collection(collection or CHROMA_COLLECTION)
    
    existing = col.get(where={"source": {"$eq": source}})
    if not existing["ids"]:
        raise ValueError(f'Source not found: "{source}"')
    
    col.delete(ids=existing["ids"])
    
    return {
        "deleted": len(existing["ids"]),
        "source": source
    }


async def list_collections() -> Dict[str, Any]:
    """List available collections"""
    cols = chroma.list_collections()
    return {
        "collections": [c.name if hasattr(c, "name") else str(c) for c in cols]
    }


# ── RLM Reasoning Engine ──────────────────────────────────

async def rlm_reason(
    query: str,
    collection: Optional[str] = None,
    source: Optional[str] = None,
    max_iterations: int = 10
) -> Dict[str, Any]:
    """Recursive Language Model reasoning over full PDF text.

    The full documents (not pre-filtered chunks) are loaded into the RLM's REPL as
    `context` = {source_filename: full_text}. The root LM only sees the query; it
    writes Python to inspect/slice `context` and calls sub-LLMs (llm_query) on pieces.
    """
    if not RLM_AVAILABLE:
        return {"error": "RLM library not installed. Install with: pip install rlms", "query": query}

    sources = [source] if source else (await list_sources(collection))["sources"]
    if not sources:
        return {"error": "No documents ingested in this collection.", "query": query}

    context = {s: (await get_document(s, collection))["full_text"] for s in sources}

    def search(query: str, k: int = 5) -> list:
        """Vector search over the ingested chunks, callable from inside the RLM REPL."""
        # Runs in completion()'s worker thread, which has no event loop → asyncio.run is safe.
        hits = asyncio.run(search_context(query, n_results=k, collection=collection, source_filter=source))["results"]
        return [{k2: h[k2] for k2 in ("source", "chunkIndex", "score", "text")} for h in hits]

    rlm = RLM(
        backend="openai",
        backend_kwargs={
            "model_name": LLM_MODEL,
            "base_url": LLAMACPP_URL,
            "api_key": "not-needed",
        },
        max_iterations=max_iterations,
        verbose=RLM_VERBOSE,  # RLM_VERBOSE=1 prints the REPL trajectory
        custom_tools={"search": {
            "tool": search,
            "description": "search(query: str, k: int = 5) -> list of {source, chunkIndex, score, text}. "
                           "Semantic (vector) search over the ingested chunks of these documents. Use it first to "
                           "locate relevant passages, then read around them in `context[source]` or pass them to llm_query.",
        }},
    )

    # Small models tend to answer famous topics from memory; pin them to the documents.
    root_prompt = (
        f"{query}\n\nAnswer ONLY from the documents in `context` (use search() to find relevant passages). "
        "When calling llm_query, include the relevant document text in the prompt. "
        "Do not use outside knowledge; if the documents don't contain the answer, say so. Cite the source filename."
    )

    try:
        # completion() is blocking; keep the MCP event loop free.
        result = await asyncio.to_thread(rlm.completion, context, root_prompt=root_prompt)
    except Exception as e:
        return {"error": f"RLM reasoning failed: {e}", "query": query, "sources_loaded": sources}

    return {
        "answer": result.response,
        "sources_loaded": sources,
        "context_chars": sum(len(t) for t in context.values()),
        "execution_time_s": round(result.execution_time, 2),
        "usage": result.usage_summary.to_dict(),
        "query": query,
    }


# ── MCP Server ────────────────────────────────────────────

app = Server("pdf-context-mcp")


@app.list_tools()
async def list_tools() -> List[Tool]:
    """List available tools"""
    tools = [
        Tool(
            name="search_pdf_context",
            description=(
                "Semantically search across all ingested PDF documents and return the most relevant "
                "text chunks. Use this to retrieve context from documentation, papers, or any PDF files "
                "that have been indexed."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "Natural language search query"},
                    "n_results": {"type": "number", "description": "Number of results to return (default 5)"},
                    "collection": {"type": "string", "description": "ChromaDB collection name (optional)"},
                    "source_filter": {"type": "string", "description": "Filter by PDF filename (partial match, optional)"}
                },
                "required": ["query"]
            }
        ),
        Tool(
            name="search_pdf_context_by_score",
            description=(
                "Semantically search across all ingested PDF documents and return ALL text chunks above "
                "a minimum similarity score threshold. Unlike the regular search which returns a fixed "
                "number of top results, this returns all results that meet the score criteria, making it "
                "useful for comprehensive context gathering."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "Natural language search query"},
                    "min_score": {"type": "number", "description": "Minimum similarity score threshold (0.0-1.0, default 0.7)"},
                    "collection": {"type": "string", "description": "ChromaDB collection name (optional)"},
                    "source_filter": {"type": "string", "description": "Filter by PDF filename (partial match, optional)"},
                    "max_results": {"type": "number", "description": "Maximum number of results to consider (default 1000)"}
                },
                "required": ["query"]
            }
        ),
        Tool(
            name="list_pdf_sources",
            description="List all PDF files that have been ingested into the vector database.",
            inputSchema={
                "type": "object",
                "properties": {
                    "collection": {"type": "string", "description": "ChromaDB collection name (optional)"}
                }
            }
        ),
        Tool(
            name="get_pdf_document",
            description="Retrieve the full text content of a specific ingested PDF by its source filename.",
            inputSchema={
                "type": "object",
                "properties": {
                    "source": {"type": "string", "description": "The PDF source filename as shown in list_pdf_sources"},
                    "collection": {"type": "string", "description": "ChromaDB collection name (optional)"}
                },
                "required": ["source"]
            }
        ),
        Tool(
            name="delete_pdf_document",
            description="Remove a specific PDF's data from the vector database.",
            inputSchema={
                "type": "object",
                "properties": {
                    "source": {"type": "string", "description": "The PDF source filename to delete"},
                    "collection": {"type": "string", "description": "ChromaDB collection name (optional)"}
                },
                "required": ["source"]
            }
        ),
        Tool(
            name="list_collections",
            description="List all available ChromaDB collections (each can hold a separate PDF corpus).",
            inputSchema={"type": "object", "properties": {}}
        )
    ]
    
    # Only add rlm_reason tool if RLM library is available
    if RLM_AVAILABLE:
        tools.append(
            Tool(
                name="rlm_reason",
                description=(
                    "Answers a question with a Recursive Language Model (RLM) over the FULL text of the ingested PDFs "
                    "(not just top search hits). A local LLM explores the documents in a Python REPL and recursively "
                    "calls sub-LLMs on relevant parts. Slower than search; use for questions that need whole-document "
                    "reasoning (aggregation, comparisons, multi-hop). Scope to one PDF with `source` when possible."
                ),
                inputSchema={
                    "type": "object",
                    "properties": {
                        "query": {"type": "string", "description": "The question or task to reason over"},
                        "collection": {"type": "string", "description": "ChromaDB collection name (optional)"},
                        "source": {"type": "string", "description": "Restrict to one PDF filename from list_pdf_sources (optional, default: all PDFs)"},
                        "max_iterations": {"type": "number", "description": "Max root REPL iterations (default 10)"}
                    },
                    "required": ["query"]
                }
            )
        )
    
    return tools


@app.call_tool()
async def call_tool(name: str, arguments: Dict[str, Any]) -> List[TextContent]:
    """Handle tool calls"""
    try:
        result = None
        
        if name == "search_pdf_context":
            result = await search_context(**arguments)
        elif name == "search_pdf_context_by_score":
            result = await search_context_by_score(**arguments)
        elif name == "list_pdf_sources":
            result = await list_sources(**arguments)
        elif name == "get_pdf_document":
            result = await get_document(**arguments)
        elif name == "delete_pdf_document":
            result = await delete_document(**arguments)
        elif name == "list_collections":
            result = await list_collections()
        elif name == "rlm_reason":
            if not RLM_AVAILABLE:
                result = {"error": "RLM library not installed. Install with: pip install rlms"}
            else:
                result = await rlm_reason(**arguments)
        else:
            raise ValueError(f"Unknown tool: {name}")
        
        return [TextContent(type="text", text=json.dumps(result, indent=2))]
    
    except Exception as e:
        return [TextContent(type="text", text=json.dumps({"error": str(e)}, indent=2))]


async def main():
    """Run the MCP server"""
    async with stdio_server() as (read_stream, write_stream):
        print("[PDF MCP] Server running. Waiting for MCP client connections...", file=sys.stderr)
        await app.run(read_stream, write_stream, app.create_initialization_options())


if __name__ == "__main__":
    asyncio.run(main())
