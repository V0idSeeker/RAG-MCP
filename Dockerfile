# syntax=docker/dockerfile:1
# One image: Python RLM MCP server (src2) + Node web UI (ui-server.js, ui/, src/)
# Cache mounts + retry loops: downloads that finished survive a failed attempt (flaky network).
FROM node:20-bookworm-slim AS node
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    for i in 1 2 3 4 5; do npm install --omit=dev --no-audit --no-fund --fetch-retries=5 && exit 0; echo "npm retry $i"; sleep 5; done; exit 1

FROM python:3.11-slim-bookworm
WORKDIR /app
ENV PIP_DEFAULT_TIMEOUT=120 PIP_RETRIES=10
# Node runtime for the UI (same Debian base, so the binary runs as-is)
COPY --from=node /usr/local/bin/node /usr/local/bin/node
# CPU-only torch keeps the image ~1GB smaller than the default CUDA build
RUN --mount=type=cache,target=/root/.cache/pip \
    for i in 1 2 3 4 5; do pip install torch --index-url https://download.pytorch.org/whl/cpu && exit 0; echo "pip retry $i"; sleep 5; done; exit 1
COPY src2/requirements.txt src2/requirements.txt
RUN --mount=type=cache,target=/root/.cache/pip \
    for i in 1 2 3 4 5; do pip install -r src2/requirements.txt && exit 0; echo "pip retry $i"; sleep 5; done; exit 1
COPY --from=node /app/node_modules ./node_modules
COPY package.json ui-server.js ./
COPY ui ./ui
COPY src ./src
COPY src2/*.py ./src2/
ENV PYTHONUNBUFFERED=1
WORKDIR /app/src2
# Default: MCP server on stdio. The `ui` compose service overrides this.
CMD ["python", "server.py"]
