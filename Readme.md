# DocMCP — PDF Vector Search + MCP Server

Ingest PDF folders into a local **ChromaDB** vector database and expose them to **Kiro IDE** (or any MCP client) as semantic search tools. Includes a web UI for ingestion, search, and collection management.

---

## Project Structure

```
DMCP2/
├── src/
│   ├── embedder.js        Embedding model (env-driven, local ONNX)
│   ├── ingest.js          PDF ingestion CLI
│   └── index.js           MCP server (stdio → Kiro)
├── ui/
│   ├── index.html         Home page
│   ├── ingest.html        Ingest page
│   ├── search.html        Search page
│   ├── style.css          Shared styles
│   └── app.js             All client-side logic
├── ui-server.js           Static file server + API routes
├── delete-collection.js   CLI collection management
├── debug-upsert.js        Debug tool for ChromaDB issues
├── docker-compose.yml     ChromaDB container
├── .env                   Your config (copy from .env.example)
├── .env.example           Config template
└── package.json
```

---

## Quick Start

### 1. Prerequisites

- **Node.js** 18+
- **Docker** (for ChromaDB)

### 2. Install

```powershell
npm install
```

### 3. Configure

Copy `.env.example` to `.env` and fill in your values:

```env
# ChromaDB
CHROMA_URL=http://localhost:8000
CHROMA_COLLECTION=pdf_context

# Embedding model (ONNX, runs fully local)
EMBEDDING_MODEL=onnx-community/embeddinggemma-300m-ONNX
EMBEDDING_DEVICE=auto
EMBEDDING_DTYPE=fp32

# HuggingFace token (only needed for gated models)
HF_TOKEN=

# Chunking
CHUNK_SIZE=800
CHUNK_OVERLAP=150

# Web UI
UI_PORT=3131
```

> **Important:** Use `fp32` for `EMBEDDING_DTYPE` on CPU. `fp16` produces NaN values on most CPUs and will cause ingestion to fail silently.

### 4. Start ChromaDB

```powershell
docker compose up -d
```

ChromaDB runs at `http://localhost:8000`. Data is persisted to a local `chroma-data/` folder.

### 5. Start the Web UI

```powershell
node ui-server.js
```

Browser opens automatically at `http://localhost:3131`.

### 6. Ingest PDFs

**Via Web UI:** Go to `/ingest`, enter your PDF folder path, select or create a collection, click Start.

**Via CLI:**

```powershell
node src/ingest.js "C:\path\to\pdfs" --collection my-docs
```

Use `--reset` to wipe and recreate the collection before ingesting:

```powershell
node src/ingest.js "C:\path\to\pdfs" --collection my-docs --reset
```

---

## Connect to Kiro IDE

Open `.kiro/settings/mcp.json` and add:

```json
{
  "mcpServers": {
    "pdf-context": {
      "command": "node",
      "args": ["C:\\absolute\\path\\to\\DMCP2\\src\\index.js"],
      "env": {
        "CHROMA_URL": "http://localhost:8000",
        "CHROMA_COLLECTION": "ECDocs"
      }
    }
  }
}
```

Set `CHROMA_COLLECTION` to the collection you ingested into, then restart Kiro.

---

## MCP Tools

| Tool | Description |
|---|---|
| `search_pdf_context` | Semantic search across all ingested PDFs |
| `list_pdf_sources` | List every PDF that has been ingested |
| `get_pdf_document` | Retrieve full text of a specific PDF |
| `delete_pdf_document` | Remove a PDF's chunks from the database |
| `list_collections` | List all ChromaDB collections |

### Example prompts in Kiro

```
Search the PDF context for the authentication flow
What does the architecture doc say about the database layer?
List all PDFs in the ECDocs collection
```

---

## Web UI

| Page | URL | Purpose |
|---|---|---|
| Home | `/` | Overview, config status |
| Ingest | `/ingest.html` | Index PDFs into a collection |
| Search | `/search.html` | Semantic search with result cards |

**Ingest page:**
- Shows existing collections with chunk counts — click to select
- Create a new collection by typing a name (min 3 chars) and clicking Use
- Live SSE log with color-coded tags: FILE / DONE / ERR / MODEL
- Progress bar per file
- Auto-refreshes collection list after completion
- Delete collections directly from the chip list

**Search page:**
- Collection dropdown auto-populated from ChromaDB
- Adjustable Top K (number input, no upper limit)
- Collapsible result cards showing match %, source filename, chunk index, and full text
- Delete collection button next to the dropdown

---

## Managing Collections

**Via Web UI:** Use the ✕ button on chips (ingest page) or the 🗑 button on the search page.

**Via CLI:**

```powershell
# List all collections with chunk counts
node delete-collection.js --list

# Delete with confirmation prompt
node delete-collection.js ECDocs

# Delete without prompt (for scripting)
node delete-collection.js ECDocs --force
```

---

## Embedding Model

The model is fully configurable via `.env`. It runs locally — no API key required for public models.

| Model | Size | Languages | Notes |
|---|---|---|---|
| `onnx-community/embeddinggemma-300m-ONNX` | ~300MB | 100+ | Best quality, recommended |
| `Xenova/paraphrase-multilingual-MiniLM-L12-v2` | ~120MB | 50+ | Lighter alternative |
| `Xenova/bge-m3` | ~570MB | 100+ | Best retrieval quality |
| `Xenova/all-MiniLM-L6-v2` | ~25MB | English only | Fastest |

First run downloads the model. Fully offline after that.

> **Switching models:** If you change `EMBEDDING_MODEL`, you must re-ingest all PDFs. Embeddings from different models are incompatible (different vector dimensions). Use `--reset` when re-ingesting.

---

## Troubleshooting

**ChromaDB unreachable**
```powershell
docker compose up -d
curl http://localhost:8000/api/v2/heartbeat
```

**422 Unprocessable Entity during ingest**
The collection has embeddings from a different model. Delete and re-ingest:
```powershell
node src/ingest.js "C:\path\to\pdfs" --collection my-docs --reset
```

**Embeddings are all NaN**
Set `EMBEDDING_DTYPE=fp32` in `.env`. `fp16` is not supported on most CPUs.

**"Collection not found" in Kiro**
`CHROMA_COLLECTION` in your Kiro MCP config must exactly match the collection name used during ingest (case-sensitive, min 3 chars, only `a-z A-Z 0-9 . _ -`).

**Kiro doesn't see the MCP tools**
- Verify the absolute path in your Kiro MCP config points to `src/index.js`
- Make sure `node` is in your PATH
- Restart Kiro after editing the config

**Debug ChromaDB upsert issues**
```powershell
node debug-upsert.js
```
This sends a test embedding directly to ChromaDB and prints the full error response.