FROM oven/bun:1 AS build
WORKDIR /app
COPY dashboard/package.json dashboard/bun.lock dashboard/
COPY shared shared
COPY package.json ./
WORKDIR /app/dashboard
RUN bun install --frozen-lockfile
COPY dashboard/ .
COPY docs /app/docs
RUN bun run build

FROM busybox:1.36
COPY --from=build /app/dashboard/dist /dist
CMD ["busybox", "httpd", "-f", "-p", "80", "-h", "/dist"]
