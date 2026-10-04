FROM node:24.21.0-bookworm-slim@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6
WORKDIR /app
COPY --chown=node:node lib/ ./lib/
COPY --chown=node:node server.mjs package.json ./
COPY --chown=node:node dist/ ./dist/
COPY --chown=node:node tests/ ./tests/
USER node
ENV NODE_ENV=production HOST=127.0.0.1 PORT=8798 DATA_DIR=/data
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD node -e "fetch('http://127.0.0.1:8798/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "server.mjs"]
