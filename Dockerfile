FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

FROM node:24-alpine
ENV NODE_ENV=production DATA_DIR=/data PORT=8443
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src
COPY public ./public
RUN mkdir /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 8443
HEALTHCHECK --interval=30s --timeout=6s --retries=3 CMD ["node", "src/healthcheck.js"]
CMD ["node", "src/server.js"]
