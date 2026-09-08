FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY web/package.json web/package-lock.json ./web/
RUN npm ci --prefix web
COPY . .
ARG HEALTH_API_ORIGIN=http://health-api:4310
ARG NEXT_PUBLIC_BASE_PATH=
ARG NEXT_PUBLIC_PREVIEW=0
ENV HEALTH_API_ORIGIN=$HEALTH_API_ORIGIN
ENV NEXT_PUBLIC_BASE_PATH=$NEXT_PUBLIC_BASE_PATH NEXT_PUBLIC_PREVIEW=$NEXT_PUBLIC_PREVIEW
RUN npm run build && npm run build:web

FROM node:22-bookworm-slim AS api
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=4310
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
RUN mkdir /app/data && chown node:node /app/data
USER node
EXPOSE 4310
CMD ["node", "dist/server.js"]

FROM api AS preview
ENV HEALTH_PREVIEW=1
CMD ["node", "dist/preview-server.js"]

FROM node:22-bookworm-slim AS web
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build --chown=node:node /app/web ./web
COPY --from=build --chown=node:node /app/src ./src
COPY --from=build --chown=node:node /app/node_modules ./node_modules
USER node
WORKDIR /app/web
EXPOSE 4320
CMD ["node", "node_modules/next/dist/bin/next", "start", "--hostname", "0.0.0.0", "--port", "4320"]
