FROM oven/bun:1-alpine AS deps
WORKDIR /app
COPY package.json bun.lock ./
COPY shared/package.json shared/
RUN bun install --frozen-lockfile --production

FROM oven/bun:1-alpine
RUN apk add --no-cache wget && addgroup -S btr && adduser -S btr -G btr
WORKDIR /app
COPY --from=deps --chown=btr:btr /app/node_modules node_modules
COPY --chown=btr:btr package.json ./
COPY --chown=btr:btr shared shared
COPY --chown=btr:btr src src
USER btr

ENV NODE_ENV=production
CMD ["bun", "src/index.ts"]
