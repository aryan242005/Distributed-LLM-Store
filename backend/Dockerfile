FROM node:20-alpine

WORKDIR /app

# Copy proto files
COPY proto/ /proto/

# Copy backend package files and install dependencies
COPY backend/package*.json ./
RUN npm install --production

# Copy backend source
COPY backend/ ./

# Expose gRPC and HTTP ports
EXPOSE 4000 5001 5002 5003

# Default command runs coordinator (can be overridden by docker-compose)
CMD ["node", "src/api/server.js"]
