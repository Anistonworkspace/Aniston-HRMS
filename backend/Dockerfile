# Stage 1: Builder
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package.json package-lock.json ./
COPY backend/package.json ./backend/
COPY shared/package.json ./shared/

# Install dependencies
RUN npm ci

# Copy source
COPY shared/ ./shared/
COPY backend/ ./backend/
COPY prisma/ ./prisma/
COPY tsconfig.json ./

# Generate Prisma client and build
RUN npx prisma generate
RUN npm run build --workspace=shared
RUN npm run build --workspace=backend

# Stage 2: Runtime
FROM node:20-alpine AS runtime

WORKDIR /app

# postgresql-client: provides pg_dump and psql for database backup/restore
# Compression/decompression is handled by Node.js zlib (no gzip binary needed)
RUN apk add --no-cache postgresql-client

# Create non-root user
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

# Copy built artifacts from builder
COPY --from=builder /app/package.json /app/package-lock.json ./
COPY --from=builder /app/backend/package.json ./backend/
COPY --from=builder /app/shared/package.json ./shared/
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/backend/dist ./backend/dist
COPY --from=builder /app/shared/dist ./shared/dist
COPY --from=builder /app/prisma ./prisma

# Set ownership
RUN chown -R appuser:appgroup /app

EXPOSE 4000

# Run as non-root
USER appuser

CMD ["node", "backend/dist/server.js"]
