FROM node:22-alpine

WORKDIR /app
COPY pi-sidecar/package.json ./package.json
COPY pi-sidecar/server.mjs ./server.mjs

ENV AI_AGENT_HOST=0.0.0.0
ENV AI_AGENT_PORT=3001
EXPOSE 3001

CMD ["node", "server.mjs"]
