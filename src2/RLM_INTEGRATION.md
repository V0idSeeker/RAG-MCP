# RLM Library Integration

The Python implementation uses the official [RLM (Recursive Language Models)](https://github.com/alexzhang13/rlm) library — PyPI package `rlms` (Python >= 3.11). Note: the PyPI package `rlm-python` is an unrelated project.

## Why RLM?

The JavaScript version implements a manual 3-pass loop (iterative RAG over top-k chunks). The Python version is a real RLM:

1. **Full documents, not top-k chunks** - `rlm_reason` loads the full text of every PDF (or one, via `source`) into a Python REPL as `context = {pdf_filename: full_text}`.
2. **The root LM never sees the whole context** - it only sees the query plus context metadata, and writes Python to search/slice `context`.
3. **Recursive sub-calls** - the root LM calls `llm_query(...)` on pieces of the documents and combines the results.
4. **Handles context larger than the model window** - useful for aggregation, comparisons, and multi-hop questions that top-k search misses.

Trade-off: slower and more LLM calls than search; quality depends on the model writing correct REPL code (an 8B local model may struggle — try a larger one if answers are poor). The local REPL runs model-written code in-process with restricted builtins; it is not a security sandbox, so only use trusted PDFs / a local model you control.

## Architecture Comparison

### JavaScript (Manual 3-Pass Loop)

```javascript
// Pass 1: Check if context is sufficient
const pass1 = await llmCall([...]);
if (pass1.startsWith("SUFFICIENT")) break;

// Pass 2: Select needed chunks
const pass2 = await llmCall([...]);
const indices = JSON.parse(pass2);

// Pass 3: Generate answer
const pass3 = await llmCall([...]);
```

**Pros:**
- No external dependencies
- Full control over prompts
- Predictable behavior

**Cons:**
- Manual prompt engineering
- Fixed reasoning pattern
- No self-correction
- Brittle JSON parsing

### Python (RLM Library)

```python
# RLM handles all reasoning internally
rlm = RLM(
    backend="openai",
    backend_kwargs={
        "model_name": "qwen-8b",
        "base_url": LLAMACPP_URL,
        "api_key": "not-needed",
    }
)

result = rlm.completion(context, root_prompt=query)  # context = {pdf: full_text}
```

**Pros:**
- Automatic reasoning optimization
- Self-correcting logic
- Transparent reasoning steps
- Robust error handling
- Extensible architecture

**Cons:**
- Additional dependency
- Less direct control
- Requires RLM library installation

## Installation

```bash
pip install rlms
```

If RLM is not installed, the server will still work but the `rlm_reason` tool will not be available.

## Usage in MCP Server

The `rlm_reason` tool automatically:

1. Retrieves relevant chunks using `search_pdf_context_by_score`
2. Formats context with source citations
3. Calls RLM's reasoning engine
4. Returns answer with sources and reasoning metadata

```python
# Example tool call
result = await rlm_reason(
    query="What are the security best practices?",
    collection="security_docs",
    min_score=0.70
)

# Returns:
{
    "answer": "Based on the documentation...",
    "sources": ["security_guide.pdf", "api_docs.pdf"],
    "chunks_used": 12,
    "chunks_retrieved": 15,
    "reasoning_steps": [...]  # Optional, if available
}
```

## Standalone Usage

You can also use RLM directly without the MCP server:

```python
from rlm import RLM
from embedder import embed_text
import chromadb

# Fetch context from ChromaDB
client = chromadb.HttpClient(host="localhost", port=8000)
collection = client.get_collection(name="pdf_context")
embedding = embed_text(query, text_type="query")
results = collection.query(query_embeddings=[embedding], n_results=10)

# Format context
context = "\n\n".join([
    f"[{meta['source']}]\n{doc}"
    for doc, meta in zip(results["documents"][0], results["metadatas"][0])
])

# Run RLM
rlm = RLM(
    backend="openai",
    backend_kwargs={
        "model_name": "qwen-8b",
        "base_url": "http://localhost:8080/v1",
        "api_key": "not-needed"
    },
    verbose=True
)

result = rlm.completion(context, root_prompt=query)  # context = {pdf: full_text}
print(result.response)
```

See `src2/example_rlm_standalone.py` for a complete working example.

## RLM Configuration

The RLM library supports various backends and configuration options:

```python
rlm = RLM(
    backend="openai",  # or "anthropic", "cohere", etc.
    backend_kwargs={
        "model_name": "qwen-8b",
        "base_url": "http://localhost:8080/v1",
        "api_key": "not-needed",
        "temperature": 0.2,
        "max_tokens": 2048
    },
    verbose=True,  # Show reasoning steps
    max_iterations=5,  # Max reasoning loops
    confidence_threshold=0.8  # Minimum confidence to stop
)
```

## Fallback Behavior

If the RLM library is not installed:

1. Server starts normally
2. `rlm_reason` tool is not listed in available tools
3. Other tools work as expected
4. Warning message printed to stderr on startup

```
[Warning] RLM library not installed. rlm_reason tool will not be available.
[Warning] Install with: pip install rlms
```

## Comparison with JavaScript Version

| Feature | JavaScript (src/) | Python (src2/) |
|---------|------------------|----------------|
| Reasoning Engine | Manual 3-pass loop | RLM library |
| Prompt Engineering | Manual | Automatic |
| Self-Correction | No | Yes |
| Reasoning Steps | Not exposed | Available |
| Error Handling | Basic | Robust |
| Extensibility | Limited | High |
| Dependencies | None (built-in) | rlms |

## Future Enhancements

Potential improvements using RLM:

1. **Multi-document reasoning** - Compare information across PDFs
2. **Fact verification** - Cross-check claims against sources
3. **Confidence scoring** - Rate answer reliability
4. **Interactive refinement** - Ask clarifying questions
5. **Citation tracking** - Precise source attribution

## References

- RLM Library: https://github.com/yourusername/rlms
- RLM Paper: [Link to paper if available]
- Example Bridge: `resources/rlm_bridge.py`
- Standalone Example: `src2/example_rlm_standalone.py`
