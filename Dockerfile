FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
COPY apps/backend/package.json ./apps/backend/

RUN npm ci --workspace=apps/backend

COPY apps/backend ./apps/backend

EXPOSE 3000

CMD ["node", "apps/backend/dist/server.js"]
