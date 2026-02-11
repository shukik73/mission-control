FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY telegram-bot.js ./

USER node

CMD ["node", "telegram-bot.js"]
