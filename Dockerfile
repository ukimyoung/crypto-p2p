# Builds the whole workspace into one image. docker-compose.yml runs the API and the web app from it.
FROM node:22-slim
RUN corepack enable
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile && pnpm build
