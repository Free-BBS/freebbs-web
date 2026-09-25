FROM node:22-bookworm-slim AS build

WORKDIR /app

COPY package.json package-lock.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/contracts/package.json packages/contracts/package.json
RUN npm ci

COPY apps/web apps/web
COPY packages/contracts/src packages/contracts/src
COPY packages/contracts/tsconfig.json packages/contracts/tsconfig.json
RUN npm run build -w @freebbs-development/contracts \
  && npm run build -w @freebbs-development/web

FROM nginxinc/nginx-unprivileged:1.27-alpine AS runtime

COPY deploy/nginx/freebbs-development.conf /etc/nginx/conf.d/default.conf
COPY --from=build --chown=101:101 /app/apps/web/dist /usr/share/nginx/html/development

USER 101
EXPOSE 8080
