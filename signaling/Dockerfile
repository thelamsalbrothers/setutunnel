# Self-hostable SetuTunnel signaling server — runs ANYWHERE Docker runs
# (a VPS, Fly.io, Railway, Render, a home server, a Raspberry Pi). No Cloudflare
# required; it speaks the exact same wire protocol as the CF Worker.
#
# Build (from the REPO ROOT, so the context includes src/signaling):
#   docker build -f signaling/Dockerfile -t setutunnel-signaling .
# Run:
#   docker run -p 8787:8787 setutunnel-signaling
# Or just `docker compose up -d` (see docker-compose.yml at the repo root).
FROM oven/bun:1-alpine

WORKDIR /app

# The server has NO runtime dependencies beyond Bun itself — it imports only the
# pure, framework-free RoomManager. So we copy just those sources and skip
# `bun install` entirely (Bun runs the TypeScript directly).
COPY src/signaling ./src/signaling
COPY signaling/server.ts ./signaling/server.ts

ENV PORT=8787
EXPOSE 8787

# Basic liveness: the server answers GET /health with "ok".
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget -qO- "http://127.0.0.1:${PORT}/health" || exit 1

CMD ["bun", "signaling/server.ts"]
