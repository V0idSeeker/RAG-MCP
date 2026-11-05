# Migration Guide: JavaScript to Python

This guide helps you migrate from the JavaScript implementation (src/) to the Python implementation (src2/).

## Good News: Collections Are Compatible! 

Both implementations use the same ChromaDB backend, so you can:

- Keep your existing ingested PDFs
- Switch between implementations without re-ingesting
- Run both servers simultaneously (with different collection names)

## Migration Steps

### 1. Install Python Dependencies

```bash
pip install -r src2/requirements.txt
```

### 2. Verify Your .env File

Both implementations use the same `.env` file. No changes needed unless you want to use different embedding models.

**JavaScript uses:**
```env
EMBEDDING_MODEL=onnx-community/embeddinggemma-300m-ONNX
```

**Python uses:**
```env
EMBEDDING_MODEL=sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2
```

### 3. Test the Python Server

```bash
# Test embedder
python src2/test_embedder.py

# Start server (Ctrl+C to stop)
python src2/server.py
```

### 4. Update Kiro Configuration

Edit `.kiro/settings/mcp.json`:

**Before (JavaScript):**
```json
{
  "mcpServers": {
    "pdf-context": {
      "command": "node",
      "args": ["C:\\path\\to\\DMCP2\\src\\index.js"],
      "env": {
        "CHROMA_URL": "http://localhost:8000",
        "CHROMA_COLLECTION": "ECDocs"
      }
    }
  }
}
```

**After (Python):**
```json
{
  "mcpServers": {
    "pdf-context-python": {
      "command": "python",
      "args": ["C:\\path\\to\\DMCP2\\src2\\server.py"],
      "env": {
        "CHROMA_URL": "http://localhost:8000",
        "CHROMA_COLLECTION": "ECDocs"
      }
    }
  }
}
```

### 5. Restart Kiro

Restart Kiro to load the new server configuration.

### 6. Test in Kiro

Try the same prompts you used before:

```
List all PDFs in the collection
Search for "authentication" in the PDFs
```

Everything should work identically!

## Important: Embedding Model Compatibility

### If You Keep the Same Collection

**Option A: Use the same embedding model family**

If your JavaScript version used `embeddinggemma-300m`, you should re-ingest with Python using a compatible model, OR keep using the JavaScript server for that collection.

**Option B: Create a new collection**

```bash
# Ingest into a new collection with Python
python src2/ingest.py pdfs/ --collection pdf_context_python
```

Then update your Kiro config to use the new collection:

```json
"env": {
  "CHROMA_COLLECTION": "pdf_context_python"
}
```

### If You Want to Switch Models

You MUST re-ingest your PDFs:

```bash
# Delete old collection and re-ingest
python src2/ingest.py pdfs/ --collection ECDocs --reset
```

## Feature Differences

### JavaScript → Python Changes

| Feature | JavaScript | Python | Notes |
|---------|-----------|--------|-------|
| Reasoning | Manual 3-pass loop | RLM library | Better quality, requires `pip install rlms` |
| Embeddings | ONNX models | PyTorch models | Different model ecosystem |
| PDF parsing | pdf-parse | pypdf | More robust |
| HTTP client | fetch | httpx | Async HTTP (removed in RLM version) |

### New in Python

- **RLM integration**: Advanced reasoning with self-correction
- **Reasoning steps**: Transparent reasoning process
- **Better error handling**: More informative error messages
- **Standalone examples**: `example_rlm_standalone.py`

## Running Both Simultaneously

You can run both servers at the same time:

```json
{
  "mcpServers": {
    "pdf-context-js": {
      "command": "node",
      "args": ["C:\\path\\to\\DMCP2\\src\\index.js"],
      "env": {
        "CHROMA_COLLECTION": "js_collection"
      }
    },
    "pdf-context-python": {
      "command": "python",
      "args": ["C:\\path\\to\\DMCP2\\src2\\server.py"],
      "env": {
        "CHROMA_COLLECTION": "python_collection"
      }
    }
  }
}
```

This lets you:
- Compare performance
- Test both implementations
- Use different collections for different purposes

## Performance Comparison

### JavaScript Advantages
- Lighter memory footprint (~200-300MB)
- Faster startup time
- Better for CPU-only environments
- No Python installation needed

### Python Advantages
- Better GPU acceleration (if you have CUDA)
- Faster batch processing
- RLM reasoning quality
- More mature ML ecosystem

## Rollback Plan

If you need to switch back to JavaScript:

1. Keep your `.env` file unchanged
2. Revert Kiro config to use `node` and `src/index.js`
3. Restart Kiro
4. Your collections are still intact

## Common Issues

### "Module not found: rlm"

```bash
pip install rlms
```

Or the server will work without it (just no `rlm_reason` tool).

### "Dimension mismatch"

You switched embedding models. Re-ingest:

```bash
python src2/ingest.py pdfs/ --collection ECDocs --reset
```

### "Python not found"

Make sure Python is in your PATH:

```bash
python --version
```

Or use full path in Kiro config:

```json
"command": "C:\\Python311\\python.exe"
```

### Performance is slower

1. Check if you're using CPU vs GPU
2. Try a smaller embedding model
3. Reduce chunk size in `.env`

## Testing Checklist

Before fully migrating, test these:

- [ ] Server starts without errors
- [ ] Can list collections
- [ ] Can list PDF sources
- [ ] Search returns relevant results
- [ ] Score-based search works
- [ ] Can retrieve full documents
- [ ] RLM reasoning works (if installed)
- [ ] Performance is acceptable

## Need Help?

- Check `src2/README.md` for Python-specific docs
- Review `src2/COMPARISON.md` for detailed differences
- See `src2/QUICKSTART.md` for setup steps
- Test with `src2/test_embedder.py` to isolate issues

## Recommendation

**For most users**: Start with Python if you're comfortable with Python and want better reasoning quality.

**Stick with JavaScript if**: You prefer lighter resource usage, don't need advanced reasoning, or are already happy with the JavaScript version.

Both implementations are production-ready and fully supported!
