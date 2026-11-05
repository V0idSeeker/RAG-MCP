# JavaScript vs Python Implementation Comparison

Both implementations provide identical MCP tools and functionality. Choose based on your preference and existing infrastructure.

## Feature Parity

| Feature | JavaScript (src/) | Python (src2/) |
|---------|------------------|----------------|
| PDF Ingestion | ✅ | ✅ |
| Semantic Search | ✅ | ✅ |
| Score-based Search | ✅ | ✅ |
| Collection Management | ✅ | ✅ |
| RLM Reasoning | ✅ | ✅ |
| MCP Server | ✅ | ✅ |
| ChromaDB Integration | ✅ | ✅ |
| Local Embeddings | ✅ | ✅ |

## Key Differences

### Embedding Models

**JavaScript:**
- Uses `@huggingface/transformers` (ONNX runtime)
- Models: `onnx-community/embeddinggemma-300m-ONNX`, `Xenova/*` models
- Runs in Node.js with ONNX backend
- First-class support for EmbeddingGemma prefixes

**Python:**
- Uses `sentence-transformers` (PyTorch)
- Models: Any sentence-transformers compatible model
- Native PyTorch with CUDA support
- Manual prefix handling for EmbeddingGemma

### PDF Parsing

**JavaScript:**
- `pdf-parse` library
- Simple text extraction

**Python:**
- `pypdf` library (formerly PyPDF2)
- More robust, actively maintained

### Reasoning Engine

**JavaScript:**
- Manual 3-pass reasoning loop
- Fixed prompt templates
- No self-correction
- Direct llama.cpp API calls

**Python:**
- RLM library integration
- Automatic reasoning optimization
- Self-correcting logic
- Transparent reasoning steps
- Graceful fallback if RLM not installed

### Dependencies

**JavaScript:**
```json
{
  "@modelcontextprotocol/sdk": "^1.0.0",
  "chromadb": "^1.9.2",
  "pdf-parse": "^1.1.1",
  "@huggingface/transformers": "^3.0.0",
  "dotenv": "^16.0.0"
}
```

**Python:**
```txt
chromadb>=0.4.0
sentence-transformers>=2.2.0
pypdf>=3.0.0
python-dotenv>=1.0.0
mcp>=0.9.0
torch>=2.0.0
rlms>=0.1.3  # Optional, for rlm_reason tool
```

### Performance

**JavaScript:**
- Lighter memory footprint
- ONNX optimized for CPU
- Good for resource-constrained environments
- Manual reasoning loop (predictable performance)

**Python:**
- Better GPU acceleration (CUDA)
- Faster batch processing with PyTorch
- More mature ML ecosystem
- RLM library adds overhead but improves answer quality

## When to Use Each

### Use JavaScript (src/) if:
- You're already in a Node.js environment
- You want lighter resource usage
- You prefer ONNX models
- You need Windows compatibility without Python setup
- Your team is more comfortable with JavaScript
- You want full control over reasoning prompts
- You prefer no external reasoning dependencies

### Use Python (src2/) if:
- You're in a Python/ML environment
- You need GPU acceleration (CUDA)
- You want access to the full sentence-transformers ecosystem
- You prefer PyTorch over ONNX
- You're doing other ML work in Python
- You want advanced reasoning with RLM library
- You prefer automatic reasoning optimization

## Migration Between Versions

Both versions use the same ChromaDB backend, so you can:

1. **Ingest with one, serve with the other** - Collections are compatible
2. **Switch implementations** - Just change your MCP config
3. **Run both simultaneously** - Use different collection names

**Important:** If you switch embedding models between implementations, you must re-ingest your PDFs. The vector dimensions must match.

## Code Structure Comparison

### Embedder

**JavaScript:** `src/embedder.js`
- Lazy-loads transformers pipeline
- Handles ONNX device selection
- Prefix logic for EmbeddingGemma

**Python:** `src2/embedder.py`
- Lazy-loads SentenceTransformer
- CUDA/CPU device selection
- Manual prefix handling

### Ingest

**JavaScript:** `src/ingest.js`
- CLI with `process.argv`
- Async/await with Node.js streams
- Progress output with `\r` carriage return

**Python:** `src2/ingest.py`
- CLI with `sys.argv`
- Synchronous with progress bars
- Pythonic error handling

### Server

**JavaScript:** `src/index.js`
- MCP SDK with stdio transport
- Switch-case tool routing
- Node.js fetch for HTTP

**Python:** `src2/server.py`
- MCP Python SDK with stdio
- Decorator-based tool routing
- httpx for async HTTP

## Testing

**JavaScript:**
```bash
# Test ingestion
node src/ingest.js pdfs/ --collection test

# Test server (requires MCP client)
node src/index.js
```

**Python:**
```bash
# Test embedder
python src2/test_embedder.py

# Test ingestion
python src2/ingest.py pdfs/ --collection test

# Test server (requires MCP client)
python src2/server.py
```

## Conclusion

Both implementations are production-ready and feature-complete. Choose based on your ecosystem and preferences. You can even run both and compare performance in your specific use case.
