FROM node:24-bookworm-slim AS build

WORKDIR /app

COPY package.json package-lock.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/contracts/package.json packages/contracts/package.json
RUN npm ci

COPY apps/api/src apps/api/src
COPY apps/api/tsconfig.json apps/api/tsconfig.json
COPY packages/contracts/src packages/contracts/src
COPY packages/contracts/tsconfig.json packages/contracts/tsconfig.json
RUN npm run build -w @freebbs-development/contracts \
  && npm run build -w @freebbs-development/api \
  && npm prune --omit=dev

FROM node:24-bookworm-slim AS runtime

ENV NODE_ENV=production
ENV PORT=3100
WORKDIR /app

COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/api/package.json apps/api/package.json
COPY --from=build /app/apps/api/dist apps/api/dist
COPY --from=build /app/packages/contracts/package.json packages/contracts/package.json
COPY --from=build /app/packages/contracts/dist packages/contracts/dist
COPY database/migrations database/migrations
COPY database/seeds database/seeds
COPY scripts scripts

RUN install -d -o node -g node -m 0700 /var/lib/freebbs-development/festival
ENV FESTIVAL_UPLOAD_DIR=/var/lib/freebbs-development/festival

USER node
EXPOSE 3100

CMD ["node", "apps/api/dist/server.js"]
