FROM node:24-alpine AS build
WORKDIR /app
COPY package*.json ./
COPY web/package.json ./web/package.json
RUN npm ci
COPY web ./web
RUN npm run build
RUN npm prune --omit=dev
FROM node:24-alpine
WORKDIR /app
ENV HOST=0.0.0.0
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/web/dist ./web/dist
COPY package*.json ./
COPY web/package.json ./web/package.json
COPY server ./server
COPY scripts ./scripts
COPY sql ./sql
USER node
EXPOSE 3000
CMD ["node","server/index.js"]
