FROM node:18-alpine AS node_modules
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build && npm install --production
CMD ["node", "src/index.js"]
