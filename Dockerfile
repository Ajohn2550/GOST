FROM docker.io/library/node:22.23.3-bookworm
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install
COPY . .
RUN npm run build
CMD ["node", "dist/server.js"]
