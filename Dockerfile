# ETMLShoot — image du serveur de jeu
FROM node:22-alpine

WORKDIR /app

# Dépendances d'abord : la couche est réutilisée tant que package*.json ne change pas
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY server ./server
COPY public ./public

ENV NODE_ENV=production \
    PORT=8080
EXPOSE 8080

# Le serveur n'a besoin d'aucun privilège
USER node

HEALTHCHECK --interval=30s --timeout=4s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1

CMD ["node", "server/index.js"]
