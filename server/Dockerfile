# Dockerfile for the server (Node.js backend)
FROM node:20-alpine

WORKDIR /app/server

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

EXPOSE 5000

CMD [ "node", "index.js" ]
