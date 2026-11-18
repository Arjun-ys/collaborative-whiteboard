FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY client/package*.json ./client/
COPY server/package*.json ./server/
# Browser builds do not use native canvas; platform packages ship their binaries.
RUN npm ci --prefix client --ignore-scripts && npm ci --prefix server --ignore-scripts
COPY client/ ./client/
COPY server/ ./server/
RUN npm run build --prefix client && npm run build --prefix server

FROM node:22-bookworm-slim AS runtime
WORKDIR /app/server
ENV NODE_ENV=production PORT=5001
COPY --chown=node:node server/package*.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY --from=build --chown=node:node /app/server/dist ./dist
COPY --from=build --chown=node:node /app/client/dist /app/client/dist
USER node
EXPOSE 5001
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s CMD node -e "fetch('http://127.0.0.1:5001/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/server.js"]
