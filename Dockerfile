# One image recipe for every service: docker build --build-arg SERVICE=booking-api .
FROM node:22-slim AS build
WORKDIR /src
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages ./packages
COPY services ./services
RUN npm ci --no-audit --no-fund
ARG SERVICE
RUN npx tsc -b packages/common services/${SERVICE} \
 && npm prune --omit=dev --no-audit --no-fund

FROM node:22-slim
ARG SERVICE
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /src/node_modules ./node_modules
COPY --from=build /src/packages/common/package.json ./packages/common/package.json
COPY --from=build /src/packages/common/dist ./packages/common/dist
COPY --from=build /src/services/${SERVICE}/package.json ./service/package.json
COPY --from=build /src/services/${SERVICE}/dist ./service/dist
WORKDIR /app/service
USER node
EXPOSE 8080
CMD ["node", "-r", "@northcrest/common/dist/telemetry.js", "dist/server.js"]
