FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages ./packages
COPY apps ./apps
COPY scripts ./scripts
COPY tsconfig*.json ./
RUN npm ci && npm run build
FROM node:22-bookworm-slim
ENV NODE_ENV=production HOST=0.0.0.0
WORKDIR /app
COPY --from=build /app/package*.json ./
COPY --from=build /app/packages ./packages
COPY --from=build /app/apps/playground/package.json ./apps/playground/package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/tsconfig*.json ./
USER node
EXPOSE 3000
CMD ["node", "packages/server/dist/main.js"]
