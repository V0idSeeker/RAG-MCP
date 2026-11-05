# Python Implementation - File Index

Complete guide to all files in the `src2/` directory.

## Core Implementation Files

### `server.py` (16KB)
**Main MCP server implementation**

- Exposes 7 MCP tools (6 always available, 1 requires RLM)
- Handles ChromaDB connections
- Implements all search and management functions
- Integrates RLM library for advanced reasoning
- Entry point: `python src2/server.py`

**Key functions:**
- `search_context()` - Top-K semantic search
- `search_context_by_score()` - Score-threshold search
- `list_sources()` - List ingested PDFs
- `get_document()` - Retrieve full PDF text
- `delete_document()` - Remove PDF from DB
- `list_collections()` - List all collections
- `rlm_reason()` - RLM-powered reasoning

### `embedder.py` (2.4KB)
**Text embedding module**

- Uses sentence-transformers library
- Lazy-loads embedding model
- Supports document and query embeddings
- Handles EmbeddingGemma prefixes
- GPU/CPU device selection

**Key functions:**
- `get_embedder()` - Initialize model
- `embed_text()` - Single text embedding
- `embed_batch()` - Batch embedding

### `ingest.py` (8.4KB)
**PDF ingestion CLI**

- Extracts text from PDFs using pypdf
- Chunks text with overlap
- Generates embeddings
- Stores in ChromaDB
- Progress tracking and error handling

**Usage:**
```bash
python src2/ingest.py <folder> [--collection name] [--reset]
```

### `__init__.py` (50B)
**Package marker**

Makes src2 a Python package.

## Documentation Files

### `README.md` (3.7KB)
**Main documentation**

- Installation instructions
- Configuration guide
- Usage examples
- Tool descriptions
- Kiro integration

**Start here** if you're new to the Python implementation.

### `QUICKSTART.md` (4.9KB)
**5-minute setup guide**

- Step-by-step installation
- Quick configuration
- First ingestion
- Testing steps
- Troubleshooting

**Best for**: Getting started quickly.

### `COMPARISON.md` (4.9KB)
**JavaScript vs Python comparison**

- Feature parity table
- Key differences
- Performance comparison
- When to use each
- Migration considerations

**Best for**: Deciding between implementations.

### `RLM_INTEGRATION.md` (5.5KB)
**RLM library deep dive**

- Why RLM?
- Architecture comparison
- Installation guide
- Usage examples
- Configuration options

**Best for**: Understanding the reasoning engine.

### `MIGRATION.md` (6.2KB)
**Migration from JavaScript**

- Step-by-step migration
- Compatibility notes
- Rollback plan
- Common issues
- Testing checklist

**Best for**: Switching from JavaScript version.

### `INDEX.md` (this file)
**File navigation guide**

Complete overview of all files in src2/.

## Example & Test Files

### `test_embedder.py` (2.2KB)
**Embedder test script**

Tests embedding functionality:
- Single text embedding
- Batch embedding
- Query vs document embeddings
- Dimension verification

**Usage:**
```bash
python src2/test_embedder.py
```

### `example_rlm_standalone.py` (4.2KB)
**Standalone RLM example**

Demonstrates using RLM without MCP:
- Direct ChromaDB access
- Context retrieval
- RLM reasoning
- Result formatting

**Usage:**
```bash
python src2/example_rlm_standalone.py "your question" [pdf_filename]
```

## Configuration Files

### `requirements.txt` (128B)
**Python dependencies**

```txt
chromadb>=0.4.0
sentence-transformers>=2.2.0
pypdf>=3.0.0
python-dotenv>=1.0.0
mcp>=0.9.0
torch>=2.0.0
rlms>=0.1.3
```

Install with: `pip install -r src2/requirements.txt`

## File Size Summary

| File | Size | Type |
|------|------|------|
| server.py | 16KB | Core |
| ingest.py | 8.4KB | Core |
| MIGRATION.md | 6.2KB | Docs |
| RLM_INTEGRATION.md | 5.5KB | Docs |
| QUICKSTART.md | 4.9KB | Docs |
| COMPARISON.md | 4.9KB | Docs |
| example_rlm_standalone.py | 4.2KB | Example |
| README.md | 3.7KB | Docs |
| embedder.py | 2.4KB | Core |
| test_embedder.py | 2.2KB | Test |
| requirements.txt | 128B | Config |
| __init__.py | 50B | Package |

**Total:** ~59KB of code and documentation

## Quick Navigation

**I want to...**

- **Get started quickly** → `QUICKSTART.md`
- **Understand the implementation** → `README.md`
- **Compare with JavaScript** → `COMPARISON.md`
- **Migrate from JavaScript** → `MIGRATION.md`
- **Learn about RLM** → `RLM_INTEGRATION.md`
- **Test the embedder** → `test_embedder.py`
- **See RLM example** → `example_rlm_standalone.py`
- **Install dependencies** → `requirements.txt`
- **Run the server** → `server.py`
- **Ingest PDFs** → `ingest.py`

## Development Workflow

### First Time Setup
1. Read `QUICKSTART.md`
2. Install from `requirements.txt`
3. Test with `test_embedder.py`
4. Ingest PDFs with `ingest.py`
5. Run `server.py`

### Daily Usage
1. Start ChromaDB: `docker compose up -d`
2. Run server: `python src2/server.py`
3. Use in Kiro or test with examples

### Troubleshooting
1. Check `QUICKSTART.md` troubleshooting section
2. Test embedder: `python src2/test_embedder.py`
3. Verify ChromaDB: `curl http://localhost:8000/api/v2/heartbeat`
4. Check logs in terminal

## Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                     Kiro IDE                            │
│                   (MCP Client)                          │
└────────────────────┬────────────────────────────────────┘
                     │ MCP Protocol (stdio)
                     ↓
┌─────────────────────────────────────────────────────────┐
│                   server.py                             │
│  ┌──────────────────────────────────────────────────┐  │
│  │  MCP Tools:                                       │  │
│  │  • search_pdf_context                            │  │
│  │  • search_pdf_context_by_score                   │  │
│  │  • list_pdf_sources                              │  │
│  │  • get_pdf_document                              │  │
│  │  • delete_pdf_document                           │  │
│  │  • list_collections                              │  │
│  │  • rlm_reason (requires RLM)                     │  │
│  └──────────────────────────────────────────────────┘  │
└────────┬────────────────────────────────┬───────────────┘
         │                                │
         ↓                                ↓
┌─────────────────────┐         ┌──────────────────────┐
│   embedder.py       │         │   RLM Library        │
│                     │         │   (rlms)       │
│ • sentence-trans.   │         │                      │
│ • embed_text()      │         │ • Reasoning engine   │
│ • embed_batch()     │         │ • Self-correction    │
└─────────────────────┘         └──────────────────────┘
         │                                │
         ↓                                ↓
┌─────────────────────────────────────────────────────────┐
│                    ChromaDB                             │
│              (http://localhost:8000)                    │
│                                                         │
│  Collections:                                           │
│  • pdf_context (default)                                │
│  • custom collections                                   │
└─────────────────────────────────────────────────────────┘
         ↑
         │ Ingestion
         │
┌─────────────────────┐
│    ingest.py        │
│                     │
│ • PDF extraction    │
│ • Text chunking     │
│ • Embedding         │
│ • ChromaDB upsert   │
└─────────────────────┘
```

## Related Files (Outside src2/)

- `/.env` - Configuration (shared with JavaScript)
- `/.env.example` - Configuration template
- `/docker-compose.yml` - ChromaDB container
- `/Readme.md` - Main project documentation
- `/resources/rlm_bridge.py` - Original RLM bridge example

## Contributing

When adding new features:

1. Update `server.py` with new tools
2. Add tests to `test_embedder.py` if needed
3. Update `README.md` with new functionality
4. Add examples to `example_rlm_standalone.py` if relevant
5. Update this `INDEX.md` file

## Version History

- **v1.0** - Initial Python implementation
  - All 7 MCP tools
  - RLM integration
  - Complete documentation
  - Example scripts

## Support & Resources

- Main docs: `README.md`
- Quick start: `QUICKSTART.md`
- Troubleshooting: Check each doc's troubleshooting section
- Examples: `test_embedder.py`, `example_rlm_standalone.py`
- Comparison: `COMPARISON.md`
- Migration: `MIGRATION.md`
