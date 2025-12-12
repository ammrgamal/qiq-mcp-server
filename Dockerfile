FROM node:20

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

# Default to Cloud Run / common reverse-proxy port
ENV PORT=8080
EXPOSE 8080
CMD ["node", "run.mjs"]