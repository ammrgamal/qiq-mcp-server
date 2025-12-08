FROM node:20-alpine

WORKDIR /app

# Copy manifests first for layer caching
COPY package.json package-lock.json* yarn.lock* pnpm-lock.yaml* ./
RUN npm ci --only=production || npm install --production

# Copy sources
COPY . .

# Cloud Run provides PORT; code falls back to 8080
ENV NODE_ENV=production

# Generic entrypoint (does not assume specific filenames elsewhere)
CMD ["node", "run.mjs"]