FROM node:24-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

FROM node:24-alpine
WORKDIR /app
RUN apk add --no-cache curl && mkdir -p /app/uploads/tickets && chown -R node:node /app/uploads
COPY --from=deps /app/node_modules ./node_modules
COPY src ./src
USER node
EXPOSE 3001
CMD ["node", "src/index.js"]
