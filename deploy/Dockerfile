# syntax=docker/dockerfile:1.7
#
# Build context: git repo root (contains app/, deploy/, docs/, assets/).
# Local test: docker build -f deploy/Dockerfile -t vto:local .
#
# Multi-stage build:
#   build stage: node:20-alpine + corepack pnpm → pnpm build (prebuild copies
#                self-hosted MediaPipe WASM + model into app/public/mediapipe/).
#   run stage:   node:20-alpine + serve@14, serving the static dist/.
#
# Expected final image: node:20-alpine (~50MB) + serve@14 (~12MB) + dist/ (~2.1MB
# + ~5.5MB self-hosted WASM + model) ≈ 70–80MB. Target: ≤100MB.

FROM node:20-alpine AS build
WORKDIR /app

# Install deps first (layer-cached unless the lockfile changes).
COPY app/package.json app/pnpm-lock.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile

# Copy the rest of the app and build. `pnpm build` runs the `prebuild` script
# (scripts/fetch-mediapipe-assets.mjs) which copies the WASM runtime and fetches
# face_landmarker.task using Node's global fetch — no curl/wget needed.
COPY app/ .
RUN pnpm build

# ---- run stage ----------------------------------------------------------------
FROM node:20-alpine AS run
WORKDIR /srv

RUN npm install -g serve@14

COPY --from=build /app/dist ./dist
COPY deploy/serve.json ./serve.json

ENV PORT=8080
EXPOSE 8080

# JSON exec form so Docker doesn't add a second shell layer; the inner sh -c
# expands ${PORT:-8080} at runtime. Use tcp:// scheme because serve@14's
# parseEndpoint calls new URL(endpoint) — a plain port number like "8080"
# produces protocol=undefined and throws "Unknown endpoint scheme".
CMD ["sh", "-c", "serve -s dist -l tcp://0.0.0.0:${PORT:-8080} -c /srv/serve.json"]
