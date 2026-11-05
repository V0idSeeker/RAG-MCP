# Python MCP Server - Quick Start Guide

Get the Python PDF context MCP server running in 5 minutes.

## Prerequisites

- Python 3.8 or higher
- Docker (for ChromaDB)
- pip or conda

## Step 1: Install Dependencies

```bash
# Navigate to project root
cd /path/to/DMCP2

# Install Python dependencies
pip install -r src2/requirements.txt

# Or if you prefer conda
conda install -c conda-forge chromadb sentence-transformers pypdf python-dotenv torch
pip install mcp rlms
```

## Step 2: Start ChromaDB

```bash
# Start ChromaDB container
docker compose up -d

# Verify it's running
curl http://localhost:8000/api/v2/heartbeat
```

## Step 3: Configure Environment

Copy `.env.example` to `.env` if you haven't already:

```bash
cp .env.example .env
```

Edit `.env` to set your preferences:

```env
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

## Step 4: Ingest PDFs

```bash
# Ingest all PDFs from a folder
python src2/ingest.py pdfs/

# With custom collection
python src2/ingest.py pdfs/ --collection my_docs

# Reset collection before ingesting
python src2/ingest.py pdfs/ --reset
```

## Step 5: Test the Server

```bash
# Test the embedder
python src2/test_embedder.py

# Start the MCP server (for testing with MCP client)
python src2/server.py
```

## Step 6: Configure Kiro

Add to `.kiro/settings/mcp.json`:

```json
{
  "mcpServers": {
    "pdf-context-python": {
      "command": "python",
      "args": ["C:\\absolute\\path\\to\\DMCP2\\src2\\server.py"],
      "env": {
        "CHROMA_URL": "http://localhost:8000",
        "CHROMA_COLLECTION": "pdf_context"
      },
      "disabled": false
    }
  }
}
```

Restart Kiro to load the server.

## Step 7: Test in Kiro

Try these prompts:

```
List all PDFs in the collection
Search for "authentication flow" in the PDFs
Use rlm_reason to explain the database architecture
```

## Optional: Setup llama.cpp for RLM Reasoning

The `rlm_reason` tool requires a local llama.cpp server:

```bash
# Download llama.cpp
git clone https://github.com/ggerganov/llama.cpp
cd llama.cpp

# Build (see llama.cpp docs for your platform)
make

# Download a model (e.g., Qwen 8B)
# Place in models/ folder

# Start server
./server -m models/qwen-8b.gguf -c 4096 --port 8080
```

Verify it's running:

```bash
curl http://localhost:8080/v1/models
```

## Troubleshooting

### "Collection not found"

Make sure you've ingested PDFs first:

```bash
python src2/ingest.py pdfs/ --collection pdf_context
```

### "RLM library not installed"

The `rlm_reason` tool requires the RLM library:

```bash
pip install rlms
```

Other tools will still work without it.

### "ChromaDB connection refused"

Make sure ChromaDB is running:

```bash
docker compose up -d
docker compose ps
```

### "Embedding model download fails"

First run downloads the model. This can take a few minutes depending on model size:

- `paraphrase-multilingual-MiniLM-L12-v2`: ~120MB
- `all-MiniLM-L6-v2`: ~25MB
- `bge-m3`: ~570MB

Make sure you have internet connection and sufficient disk space.

### "CUDA out of memory"

If using GPU and getting OOM errors:

```env
# Switch to CPU in .env
EMBEDDING_DEVICE=cpu
```

Or use a smaller model:

```env
EMBEDDING_MODEL=sentence-transformers/all-MiniLM-L6-v2
```

## Next Steps

- Read `src2/README.md` for detailed documentation
- Check `src2/COMPARISON.md` to compare with JavaScript version
- See `src2/RLM_INTEGRATION.md` for RLM library details
- Try `src2/example_rlm_standalone.py` for standalone RLM usage

## Common Commands

```bash
# Ingest PDFs
python src2/ingest.py pdfs/ --collection my_docs

# Reset and re-ingest
python src2/ingest.py pdfs/ --collection my_docs --reset

# Test embedder
python src2/test_embedder.py

# Run standalone RLM example
python src2/example_rlm_standalone.py "your question" [pdf_filename]

# Start MCP server
python src2/server.py
```

## Performance Tips

1. **Use GPU if available**: Set `EMBEDDING_DEVICE=cuda` in `.env`
2. **Batch ingestion**: Process multiple PDFs at once
3. **Adjust chunk size**: Larger chunks = fewer embeddings but less granular search
4. **Use appropriate model**: Smaller models are faster but less accurate
5. **Persistent ChromaDB**: Data persists in Docker volume, no need to re-ingest

## Support

- Check existing issues in the repository
- Read the main `Readme.md` for general information
- Review `src2/` documentation files
- Test with `src2/test_embedder.py` to isolate issues
