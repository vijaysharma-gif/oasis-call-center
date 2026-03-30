FROM public.ecr.aws/docker/library/node:20-alpine

WORKDIR /app

# Install dependencies first (layer cache)
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Copy source
COPY src/ ./src/

EXPOSE 3001

CMD ["node", "src/server.js"]
