FROM node:24-alpine AS dependencies
WORKDIR /app
RUN npm install -g pnpm@12.4.2
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN pnpm install --frozen-lockfile

FROM dependencies AS build
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm run build

FROM node:24-alpine AS web
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=3000
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
COPY --chown=node:node certs ./certs
USER node
EXPOSE 3000
CMD ["node", "server.js"]

FROM node:24-alpine AS worker
WORKDIR /app
ENV NODE_ENV=production
COPY --from=dependencies --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node package.json tsconfig.json ./
COPY --chown=node:node lib ./lib
COPY --chown=node:node scripts ./scripts
COPY --chown=node:node certs ./certs
USER node
CMD ["node", "--import", "tsx", "scripts/worker.ts"]
