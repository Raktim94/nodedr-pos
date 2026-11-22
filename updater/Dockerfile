# No dependencies: talks to the Docker Engine API over the mounted socket.
FROM node:26-alpine
WORKDIR /app
COPY server.js ./
USER root
EXPOSE 8080
CMD ["node", "server.js"]
