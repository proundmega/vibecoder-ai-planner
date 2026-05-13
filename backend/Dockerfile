FROM node:18-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm install --production

FROM node:18-alpine AS runner
WORKDIR /app
COPY --from=builder /app/package*.json ./
RUN npm ci --only=production
RUN npm install --only=production
COPY --from=builder /app/src ./src
COPY --from=builder /app/.env.example /app/.env.example

CMD ["sh", "-c", "node src/index.js"]
