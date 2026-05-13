FROM node:18-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm install --production

FROM node:18-alpine
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/src ./src
WORKDIR /app/src
CMD ["node", "index.js"]
