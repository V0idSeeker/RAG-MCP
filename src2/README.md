# PDF Context MCP Server - Python Implementation

This is a Python port of the JavaScript MCP server with identical functionality.

## Installation

```bash
# Install dependencies
pip install -r requirements.txt

# Or install individually
pip install chromadb sentence-transformers pypdf python-dotenv mcp torch rlms

# Or with conda/mamba
conda install -c conda-forge chromadb sentence-transformers pypdf python-dotenv torch
pip install mcp rlms
```

## RLM Library

The Python implementation uses the [RLM (Recursive Language Model)](https://github.com/yourusername/rlms) library for advanced reasoning. This provides:

- Automatic reasoning step decomposition
- Context-aware information retrieval
- Self-correcting reasoning loops
- Better answer quality than manual prompt engineering

If RLM is not installed, the server will still work but the `rlm_reason` tool will not be available.

## Configuration

Copy `.env.example` to `.env` and configure:

```bash
# ChromaDB
CHROMA_URL=http://localhost:8000
CHROMA_COLLECTION=pdf_context

# llama.cpp server (for rlm_reason tool)
LLAMACPP_URL=http://localhost:8080/v1

# Embedding model
EMBEDDING_MODEL=sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2
EMBEDDING_DEVICE=cpu  # or "cuda" for GPU

# Chunking
CHUNK_SIZE=800
CHUNK_OVERLAP=150
```

## Usage

### 1. Ingest PDFs

```bash
# Ingest all PDFs from a folder
python src2/ingest.py pdfs/

# With custom collection
python src2/ingest.py pdfs/ --collection my_docs

# Reset collection before ingesting
python src2/ingest.py pdfs/ --reset
```

### 2. Run the MCP Server

```bash
python src2/server.py
```

### 3. Configure in Kiro

Add to your MCP configuration (`.kiro/settings/mcp.json` or `~/.kiro/settings/mcp.json`):

```json
{
  "mcpServers": {
    "pdf-context-python": {
      "command": "python",
      "args": ["src2/server.py"],
      "cwd": "/path/to/your/project",
      "disabled": false
    }
  }
}
```

## Available Tools

1. **search_pdf_context** - Top-K semantic search
2. **search_pdf_context_by_score** - Score-threshold search (returns all above threshold)
3. **list_pdf_sources** - List all ingested PDFs
4. **get_pdf_document** - Get full text of a specific PDF
5. **delete_pdf_document** - Remove a PDF from the database
6. **list_collections** - List all ChromaDB collections
7. **rlm_reason** - Multi-pass recursive reasoning with local LLM

## RLM Reasoning Tool

The `rlm_reason` tool uses the RLM library for advanced recursive reasoning:

**How it works:**
1. Retrieves relevant chunks using `search_pdf_context_by_score`
2. Formats context with source citations and relevance scores
3. Uses RLM's reasoning engine to:
   - Decompose the query into sub-questions
   - Identify which context is actually needed
   - Generate a complete, sourced answer
4. Returns the answer with source PDFs and reasoning metadata

**Benefits over manual prompting:**
- Automatic reasoning step decomposition
- Self-correcting logic
- Better handling of complex queries
- Transparent reasoning process

Requires a running llama.cpp server at `http://localhost:8080/v1` (configurable via `LLAMACPP_URL`).

## Differences from JavaScript Version

- Uses `sentence-transformers` instead of `@huggingface/transformers`
- Uses `pypdf` instead of `pdf-parse`
- Uses `mcp` Python SDK instead of `@modelcontextprotocol/sdk`
- Async/await patterns adapted for Python's asyncio

## Performance Notes

- First run will download the embedding model (~120-300MB depending on model)
- GPU acceleration available with CUDA-enabled PyTorch
- Batch processing for efficient ingestion
