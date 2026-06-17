FROM node:18-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm install --production

FROM node:18-alpine AS runner
WORKDIR /app
RUN apk add --no-cache curl
COPY --from=builder /app/package*.json ./
RUN npm ci --only=production
COPY --from=builder /app/src ./src

EXPOSE 3001
CMD ["node", "src/index.js"]
