import asyncio
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client
from rlm import RLM
import json

# ── Config ────────────────────────────────────────────────────────────────────
MCP_SERVER_PATH = "C:/absolute/path/to/DMCP2/src/index.js"
CHROMA_COLLECTION = "ECDocs"       # your collection name
CHROMA_URL = "http://localhost:8000"
LLAMACPP_URL = "http://localhost:8080/v1"
TOP_K = 10  # how many chunks to retrieve

# ── Step 1: Pull context from your MCP server ─────────────────────────────────
async def fetch_context(query: str) -> str:
    server_params = StdioServerParameters(
        command="node",
        args=[MCP_SERVER_PATH],
        env={
            "CHROMA_URL": CHROMA_URL,
            "CHROMA_COLLECTION": CHROMA_COLLECTION
        }
    )

    async with stdio_client(server_params) as (read, write):
        async with ClientSession(read, write) as session:
            await session.initialize()

            # Use search_pdf_context_by_score for comprehensive context
            result = await session.call_tool(
                "search_pdf_context_by_score",
                arguments={
                    "query": query,
                    "min_score": 0.70,   # adjust based on your needs
                }
            )

            # Parse the returned chunks into a single context string
            chunks = json.loads(result.content[0].text)
            context_parts = []
            for chunk in chunks:
                source = chunk.get("source", "unknown")
                text = chunk.get("text", "")
                score = chunk.get("score", 0)
                context_parts.append(f"[Source: {source} | Score: {score:.2f}]\n{text}")

            return "\n\n---\n\n".join(context_parts)

# ── Step 2: Run RLM over the retrieved context ────────────────────────────────
def run_rlm(query: str, context: str) -> str:
    rlm = RLM(
        backend="openai",
        backend_kwargs={
            "model_name": "qwen-8b",
            "api_base": LLAMACPP_URL,
            "api_key": "not-needed",
        },
        verbose=True,
    )

    result = rlm.completion(query, context=context)
    return result.response

# ── Main ──────────────────────────────────────────────────────────────────────
async def main():
    query = input("Enter your question: ")

    print("\n[1/2] Fetching context from your MCP server...")
    context = await fetch_context(query)
    print(f"      Retrieved {len(context)} chars of context\n")

    print("[2/2] Running RLM reasoning over context...")
    answer = run_rlm(query, context)

    print("\n── Answer ──────────────────────────────────────────")
    print(answer)

if __name__ == "__main__":
    asyncio.run(main())