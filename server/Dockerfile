FROM node:22-alpine

WORKDIR /app

# Копируем зависимости сервера
COPY server/package*.json ./server/
RUN cd server && npm install --production

# Копируем исходники сервера и скомпилированный фронтенд
COPY server/ ./server/
COPY web/dist ./web/dist

EXPOSE 3001

WORKDIR /app/server
CMD ["node", "index.js"]
