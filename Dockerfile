# Image Node 22 (alignée sur la CI et les tests). La variante "slim" n'inclut
# pas les outils de compilation : on les ajoute pour les modules natifs
# (better-sqlite3, argon2).
FROM node:22-bookworm-slim

# Outils de compilation pour les modules natifs (better-sqlite3, argon2).
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Installe TOUTES les dépendances (y compris devDependencies : Vite + Sass
# sont nécessaires pour construire le front). npm ci installe exactement le
# package-lock.json -> build reproductible. Bonne mise en cache des couches.
COPY package.json package-lock.json ./
RUN npm ci

# Copie les sources nécessaires au build front + au serveur.
COPY vite.config.js ./
COPY src ./src
COPY static ./static
COPY server ./server
COPY import-data ./import-data

# Construit le front (SCSS + modules JS) : génère public/ servi par Express.
RUN npm run build

# Allège l'image : on retire les devDependencies après le build.
RUN npm prune --omit=dev

# La base de données vit dans /app/data, monté en volume (voir compose).
ENV DATA_DIR=/app/data
ENV PORT=3000
EXPOSE 3000

# Au démarrage : initialise/complète la base (lieux + sélection de jeux au
# tout premier lancement) puis lance le serveur.
CMD ["sh", "-c", "node server/seed.js && node server/index.js"]
