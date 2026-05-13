FROM node:18-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm install --production

FROM node:18-alpine
COPY --from=builder /app/node_modules ./node_modules
WORKDIR /app
COPY --from=builder /app/src ./src
CMD ["node", "src/index.js"]
