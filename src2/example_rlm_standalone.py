#!/usr/bin/env python3
"""
Standalone RLM example: runs the same rlm_reason used by the MCP server,
without an MCP client. Needs ChromaDB + llama.cpp running and `pip install rlms`.

Usage: python src2/example_rlm_standalone.py "your question" [pdf_filename]
"""
import sys
import json
import asyncio
from server import rlm_reason

if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    query = sys.argv[1]
    source = sys.argv[2] if len(sys.argv) > 2 else None
    print(json.dumps(asyncio.run(rlm_reason(query, source=source)), indent=2))
