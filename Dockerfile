# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS base
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates curl \
  && rm -rf /var/lib/apt/lists/*

FROM base AS deps
COPY package.json package-lock.json* ./
RUN npm ci

FROM deps AS build
COPY prisma ./prisma
RUN npx prisma generate
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
COPY openapi.yaml ./
RUN npm run build

FROM base AS production
ENV NODE_ENV=production
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev
COPY prisma ./prisma
RUN npx prisma generate
COPY --from=build /app/dist ./dist
COPY openapi.yaml ./
COPY docker/entrypoint.sh ./docker/entrypoint.sh
RUN chmod +x ./docker/entrypoint.sh
EXPOSE 5000
USER node
ENTRYPOINT ["./docker/entrypoint.sh"]
CMD ["node", "dist/server.js"]

FROM deps AS development
ENV NODE_ENV=development
COPY prisma ./prisma
RUN npx prisma generate
COPY . .
EXPOSE 5000
CMD ["npm", "run", "dev"]
