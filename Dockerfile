FROM node:22-bookworm-slim

ARG EXTRA_AI_CLIENTS=""

RUN apt-get update && apt-get install -y --no-install-recommends \
    git gh ripgrep jq curl ca-certificates procps less vim-tiny openssh-client \
    && rm -rf /var/lib/apt/lists/* \
    && npm install -g @anthropic-ai/claude-code ${EXTRA_AI_CLIENTS}

ENV CLAUDE_CONFIG_DIR=/root/.claude
ENV CODEX_CONFIG_DIR=/root/.codex
ENV GROK_CONFIG_DIR=/root/.grok
ENV GEMINI_CONFIG_DIR=/root/.gemini
WORKDIR /work
CMD ["sleep", "infinity"]
