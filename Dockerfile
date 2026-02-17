FROM oven/bun:1 AS deps
WORKDIR /app
COPY package.json bun.lock ./
COPY shared/package.json shared/
RUN bun install --frozen-lockfile --production

FROM oven/bun:1
WORKDIR /app
COPY --from=deps /app/node_modules node_modules
COPY package.json ./
COPY shared shared
COPY src src

ENV NODE_ENV=production
EXPOSE 3001
CMD ["bun", "src/index.ts", "run"]
