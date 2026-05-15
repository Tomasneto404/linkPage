FROM node:24-alpine

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY src/ ./src/
COPY public/ ./public/

ENV PORT=3000
ENV DATA_DIR=/app/data
ENV UPLOADS_DIR=/app/data/uploads

EXPOSE 3000

VOLUME ["/app/data"]

CMD ["node", "src/server.js"]
