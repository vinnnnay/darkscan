# syntax=docker/dockerfile:1
#
# Two images from one build:
#   --target bench   the static test shop on :4173, no browser, no node_modules
#   --target tools   the crawler, agent, detectors, eval and field CLIs, with Chromium
#
# Node 24 runs the .ts entry points directly through its own type stripping, exactly as the
# repository expects (engines: >=22.18).
ARG NODE_IMAGE=node:24-bookworm-slim

# ---- deps: installed from the lockfile alone, so source edits do not reinstall ----
FROM ${NODE_IMAGE} AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/darkbench/package.json apps/darkbench/
COPY packages/agent/package.json packages/agent/
COPY packages/crawler/package.json packages/crawler/
COPY packages/dashboard/package.json packages/dashboard/
COPY packages/detectors/package.json packages/detectors/
COPY packages/eval/package.json packages/eval/
COPY packages/field/package.json packages/field/
COPY packages/report/package.json packages/report/
COPY packages/schema/package.json packages/schema/
COPY packages/session/package.json packages/session/
# The browser is installed once, in the tools stage, not per npm package.
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
RUN npm ci

# ---- build: export the test shop ----
FROM deps AS build
COPY . .
RUN npm run build:bench

# ---- bench: serve the export; nothing else is needed to run it ----
FROM ${NODE_IMAGE} AS bench
WORKDIR /app
ENV PORT=4173
COPY --from=build /app/apps/darkbench/out ./apps/darkbench/out
COPY --from=build /app/apps/darkbench/scripts/serve.ts ./apps/darkbench/scripts/serve.ts
EXPOSE 4173
HEALTHCHECK --interval=5s --timeout=5s --retries=12 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4173)+'/?v=0').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/darkbench/scripts/serve.ts"]

# ---- tools: everything that drives a browser ----
FROM build AS tools
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
# Chromium cannot use its own sandbox as root; the container is the boundary instead.
ENV DARKSCAN_CHROMIUM_NO_SANDBOX=1
RUN npx playwright install --with-deps chromium && chmod -R a+rX /ms-playwright
CMD ["npm", "test"]
