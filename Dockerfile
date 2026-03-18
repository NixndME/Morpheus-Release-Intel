# ─── Stage 1: Build React frontend ──────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /build

# Install frontend deps
COPY package.json ./
RUN npm install

# Copy source and build
COPY index.html vite.config.js ./
COPY src/ ./src/
COPY public/ ./public/
RUN npm run build
# Output is in /build/dist


# ─── Stage 2: Production Node server ─────────────────────────────────────────
FROM node:20-alpine AS runner

WORKDIR /app

# Install server deps using server.package.json
COPY server.package.json ./package.json
RUN npm install --omit=dev

# Copy built React app and server
COPY --from=builder /build/dist ./dist
COPY server.js ./

# Non-root user for security
RUN addgroup -S appgroup && adduser -S appuser -G appgroup \
    && mkdir -p /app/data \
    && chown -R appuser:appgroup /app/data
USER appuser

ENV PORT=3000
EXPOSE 3000

CMD ["node", "server.js"]
