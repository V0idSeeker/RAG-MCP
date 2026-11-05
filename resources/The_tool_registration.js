server.tool(
  "rlm_reason",
  {
    description:
      "Recursively reasons over PDF context to produce a complete, sourced answer. Unlike search tools that return raw chunks, this tool determines exactly what information is needed and returns a fully reasoned response.",
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
          description: "Minimum similarity score for retrieval (optional, default 0.70)",
        },
        max_iterations: {
          type: "number",
          description: "Max reasoning iterations (optional, default 3)",
        },
      },
      required: ["query"],
    },
  },
  async ({ query, collection, min_score = 0.70, max_iterations = 3 }) => {
    try {
      // Override collection if provided
      if (collection) process.env.CHROMA_COLLECTION = collection;

      // Initial retrieval using your existing search function
      const chunks = await searchByScore(query, min_score);

      if (!chunks || chunks.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                error: "No relevant context found for this query.",
                query,
              }),
            },
          ],
        };
      }

      // Run the RLM reasoning loop
      const result = await rlmReason(query, chunks, max_iterations);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (err) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ error: err.message, query }),
          },
        ],
      };
    }
  }
);