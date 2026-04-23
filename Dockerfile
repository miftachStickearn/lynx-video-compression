FROM node:18-alpine

# FFmpeg is bundled via ffmpeg-static; no system install needed
WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev && npm cache clean --force

# Non-root user for security
RUN addgroup -g 1001 -S nodejs && adduser -S nodejs -u 1001
RUN mkdir -p /tmp/uploads /tmp/outputs && chown -R nodejs:nodejs /tmp/uploads /tmp/outputs

COPY --chown=nodejs:nodejs . .

USER nodejs

ENV PORT=3020
ENV NODE_ENV=production

EXPOSE 3020

CMD ["node", "src/app.js"]
# ──────────────────────────────────────────────
# Production image
# ──────────────────────────────────────────────
FROM node:18-alpine

WORKDIR /app

# FFmpeg + build deps for native modules
RUN apk add --no-cache ffmpeg python3 make g++ && rm -rf /var/cache/apk/*

# Install production deps first (layer cache optimisation)
COPY package*.json ./
RUN npm install --omit=dev && npm cache clean --force

# Non-root user
RUN addgroup -g 1001 -S nodejs && adduser -S nodejs -u 1001

# Upload / log directories
RUN mkdir -p uploads/videos uploads/compressed logs && chown -R nodejs:nodejs /app

# Application code
COPY --chown=nodejs:nodejs . .

USER nodejs

ENV PORT=3020
ENV NODE_ENV=production

EXPOSE 3020

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node healthcheck.js

CMD ["npm", "start"]
# Use official Node.js runtime as base image
FROM node:18-alpine

# Set working directory
WORKDIR /app

# Install system dependencies including FFmpeg
RUN apk add --no-cache \
    ffmpeg \
    python3 \
    make \
    g++ \
    && rm -rf /var/cache/apk/*

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install --omit=dev && npm cache clean --force

# Create app user for security
RUN addgroup -g 1001 -S nodejs
RUN adduser -S nodejs -u 1001

# Create necessary directories
RUN mkdir -p uploads logs && chown -R nodejs:nodejs /app

# Copy application code
COPY --chown=nodejs:nodejs . .

# Switch to non-root user
USER nodejs

# Expose port
ENV PORT=3020
EXPOSE 3020

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node healthcheck.js

# Start application
CMD ["npm", "start"]