# Dockerfile for the client (React frontend)

# Stage 1: Build the React application
FROM node:20-alpine AS builder

WORKDIR /app/client

COPY package*.json ./
RUN npm install --omit=dev

COPY . .
RUN npm run build

# Stage 2: Serve the React application with Nginx
FROM nginx:stable-alpine

COPY --from=builder /app/client/build /usr/share/nginx/html

# EXPOSE 3000

CMD [ "nginx", "-g", "daemon off;" ]
