FROM node:18-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build && npm install --production
CMD ["node", "src/index.js"]

FROM node:18-alpine
COPY --from=builder /app/node modules ./node_modules
COPY --from=builder /app/out /app/out
WORKDIR /app/out
CMD ["node", "index.js"]
