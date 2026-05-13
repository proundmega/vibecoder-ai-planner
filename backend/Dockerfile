FROM node:18-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm install --production

FROM node:18-alpine
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/src ./src
WORKDIR /app
CMD ["node", "src/index.js"]

FROM node:18-alpine
COPY --from=builder /app/node modules ./node_modules
COPY --from=builder /app/out /app/out
WORKDIR /app/out
CMD ["node", "index.js"]
