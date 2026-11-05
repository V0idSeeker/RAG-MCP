// ── RLM Reasoning Engine ───────────────────────────────────────────────────
const LLAMACPP_URL = process.env.LLAMACPP_URL || "http://localhost:8080/v1";

async function llmCall(messages) {
  const res = await fetch(`${LLAMACPP_URL}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "qwen-8b",
      messages,
      max_tokens: 1024,
      temperature: 0.2,
    }),
  });
  const data = await res.json();
  return data.choices[0].message.content.trim();
}

async function rlmReason(query, chunks, maxIterations = 3) {
  let selectedChunks = chunks;
  let iteration = 0;

  while (iteration < maxIterations) {
    iteration++;

    // ── Pass 1: Is the context sufficient? ──────────────────────────────
    const pass1 = await llmCall([
      {
        role: "system",
        content: `You are a research assistant. Analyze if the provided context chunks are sufficient to fully answer the query. 
If sufficient, respond with exactly: SUFFICIENT
If not, respond with exactly: NEED: <what is missing> | SEARCH: <refined search query>`,
      },
      {
        role: "user",
        content: `Query: ${query}\n\nContext chunks:\n${selectedChunks
          .map((c, i) => `[${i}] (${c.source}, score: ${c.score?.toFixed(2)})\n${c.text}`)
          .join("\n\n")}`,
      },
    ]);

    // If sufficient or last iteration, move to final answer
    if (pass1.startsWith("SUFFICIENT") || iteration === maxIterations) break;

    // ── If more context needed, refine the search ────────────────────────
    const searchMatch = pass1.match(/SEARCH:\s*(.+)/);
    if (searchMatch) {
      const refinedQuery = searchMatch[1].trim();
      const extra = await searchByScore(refinedQuery, 0.68); // your existing fn
      // Merge, deduplicate by text
      const seen = new Set(selectedChunks.map((c) => c.text));
      for (const c of extra) {
        if (!seen.has(c.text)) selectedChunks.push(c);
      }
    }
  }

  // ── Pass 2: Select only the truly needed chunks ──────────────────────────
  const pass2 = await llmCall([
    {
      role: "system",
      content: `You are a research assistant. From the provided chunks, return ONLY a JSON array of indices (e.g. [0, 2, 5]) of chunks that directly help answer the query. Return ONLY the JSON array, nothing else.`,
    },
    {
      role: "user",
      content: `Query: ${query}\n\nChunks:\n${selectedChunks
        .map((c, i) => `[${i}] (${c.source})\n${c.text}`)
        .join("\n\n")}`,
    },
  ]);

  let usedChunks = selectedChunks;
  try {
    const indices = JSON.parse(pass2);
    usedChunks = indices.map((i) => selectedChunks[i]).filter(Boolean);
  } catch {
    // If parsing fails, use all chunks
  }

  // ── Pass 3: Generate the final complete answer ───────────────────────────
  const pass3 = await llmCall([
    {
      role: "system",
      content: `You are a research assistant. Using ONLY the provided context chunks, write a complete, detailed, self-contained answer. Cite the source PDF filename for every claim you make.`,
    },
    {
      role: "user",
      content: `Query: ${query}\n\nContext:\n${usedChunks
        .map((c) => `[${c.source}]\n${c.text}`)
        .join("\n\n")}`,
    },
  ]);

  return {
    answer: pass3,
    sources: [...new Set(usedChunks.map((c) => c.source))],
    chunks_used: usedChunks.length,
    chunks_retrieved: chunks.length,
  };
}