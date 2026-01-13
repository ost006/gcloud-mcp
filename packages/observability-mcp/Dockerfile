# Build stage
FROM node:22-alpine AS builder

WORKDIR /app

# Copy root package files
COPY package*.json ./
COPY turbo.json ./
COPY tsconfig.json ./

# Copy observability-mcp package
COPY packages/observability-mcp/package*.json ./packages/observability-mcp/
COPY packages/observability-mcp/tsconfig.json ./packages/observability-mcp/
COPY packages/observability-mcp/vitest.config.ts ./packages/observability-mcp/
COPY packages/observability-mcp/build.js ./packages/observability-mcp/
COPY packages/observability-mcp/src ./packages/observability-mcp/src

# Install dependencies
RUN npm ci --workspace=@google-cloud/observability-mcp

# Build the project
RUN npm run build --workspace=@google-cloud/observability-mcp

# Production stage
FROM node:22-alpine

WORKDIR /app

# Copy only necessary files from builder
COPY --from=builder /app/packages/observability-mcp/dist ./dist
COPY --from=builder /app/packages/observability-mcp/package*.json ./
COPY --from=builder /app/node_modules ./node_modules

# Expose HTTP port
EXPOSE 3000

# Set environment variables
ENV NODE_ENV=production
ENV PORT=3000

# Run the HTTP server
CMD ["node", "dist/bundle-http.js"]
