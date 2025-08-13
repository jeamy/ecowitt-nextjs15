FROM node:20-bookworm-slim

WORKDIR /app

## System deps (minimal)
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# Copy package files and install dependencies
COPY package.json package-lock.json* ./
RUN npm ci

# Copy source code
COPY . .

# Build the application
RUN npm run build

# Set environment variables
EXPOSE 3010
ENV PORT=3010
ENV NODE_ENV=production

# Start the server
CMD ["npm", "run", "start"]
