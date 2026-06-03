# 🎲 Boardgames Planner - Planificateur de Soirées Jeux de Société

*__Read this in:__ [English](README.md) | Français*

Site web des soirées jeux de société de la MJC Estrablin : calendrier des prochaines dates, ludothèque consultable (collection MyLudo) et espace d'administration pour gérer les soirées, les lieux et les jeux.

Aucune base de données externe : tout est stocké dans un simple fichier **SQLite**.

Le front-end est construit avec **Vite** (regroupement des modules JS) et **Sass/SCSS** (styles organisés par fichier, sans aucune balise `<style>` dans le HTML). Le serveur **Express** sert ensuite le résultat compilé. Le mot de passe administrateur est stocké **haché avec Argon2id** (recommandation OWASP).

<img width="1124" height="2220" alt="screenshot" src="https://github.com/user-attachments/assets/2025a33d-3cea-4e69-9dfe-2ec065d452ba" />

---

## Ce que fait le site

**Côté visiteurs** (page unique avec défilement) :
- Aperçu de la ludothèque + page dédiée `/jeux.html` avec recherche, filtres (jeux de base / extensions) et tri par note.
- Infos pratiques, lieux, contact et liens d'inscription **WhatsApp** pour les soirées qui le proposent.
- **Section adhésion** : téléchargement du bulletin d'adhésion (PDF) à remplir et à régler sur place.
- **Ajout à l'agenda** : téléchargement des prochaines soirées au format `.ics` (abonnement possible via `webcal://`), depuis les infos pratiques.
- **Calendrier interactif** : la légende est **dynamique** (seuls les types de soirées présents dans le mois affiché y figurent, avec leur couleur). Cliquer sur une carte de soirée recadre le calendrier sur la date et affiche le lieu sur une **mini-carte** (OpenStreetMap) ; le bouton « Voir les jeux de cette soirée » ouvre le détail.
- **Multilingue** (français / anglais) : sélecteur dans la barre de navigation, langue détectée puis mémorisée. Voir la section dédiée plus bas.
- Thème clair / sombre.

**Côté administration** (`/admin.html`, protégée par mot de passe) :
- Créer / modifier / dupliquer / supprimer des soirées (présentées en **deux tableaux** : à venir et passées), choisir leur lieu et cocher les jeux disponibles ce soir-là.
- Gérer les **types de soirées** depuis un onglet dédié : libellé, mention (« sur inscription »…), **couleur** et proposition d'inscription WhatsApp. Les types alimentent le formulaire de soirée, le calendrier et les badges.
- Gérer la liste des lieux (choix rapide à la création d'une date). Chaque lieu est **localisé d'un clic sur une carte Leaflet** (OpenStreetMap) : les coordonnées sont enregistrées et le lien Google Maps en est dérivé automatiquement (plus aucune URL à coller). « Supprimer » un lieu l'**archive** : il disparaît du site public mais reste désarchivable.
- Importer la collection depuis un export **MyLudo** (CSV ou JSON). La **date de création** de chaque jeu est conservée d'un import à l'autre ; la date de modification est mise à jour.
- Ajouter une image et un « apporté par » à chaque jeu (conservés lors des ré-imports), ou supprimer un jeu.
- Régler l'**identité du site** (nom, description et image de partage, utilisés pour les aperçus de liens via OpenGraph et pour le nom du flux d'agenda), les liens WhatsApp, le profil MyLudo et le mot de passe.

---

## Installation avec Docker (recommandé)

> Prérequis : Docker et Docker Compose.

### Méthode A — un simple `docker-compose.yml` (Dockge, Portainer, Komodo…)

**Aucun clone du dépôt n'est nécessaire** : Docker sait construire l'image
directement depuis l'URL Git. Dans ton gestionnaire de stacks (Dockge,
Portainer…), crée une nouvelle stack et colle ce `docker-compose.yml` :

```yaml
services:
  boardgames-planner:
    build: https://github.com/Arubinu/boardgames-planner.git
    container_name: boardgames-planner
    ports:
      - 3001:3000 # le site sera sur http://IP:3001 (modifie le nombre de gauche)
    volumes:
      - ./data:/app/data # base SQLite persistée
    environment:
      TRUST_PROXY: 1
      #ADMIN_PASSWORD: admin
      LOGIN_RETRY_DELAY: 10
      #MYLUDO_PROFILE: https://www.myludo.fr/#!/profil/[...]
      #WHATSAPP_MAIN: https://chat.whatsapp.com/[...]
      #WHATSAPP_MJC: https://chat.whatsapp.com/[...]
    healthcheck:
      test: ['CMD', 'wget', '-qO-', 'http://localhost:3000/healthz']
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 20s
    restart: unless-stopped
```

L'outil construit l'image à partir du `Dockerfile` du dépôt, puis démarre le
conteneur. Pour **mettre à jour** vers la dernière version, relance une
construction (bouton « rebuild », ou `docker compose up -d --build` en terminal) :
Docker re-clone l'URL Git et reconstruit l'image.

### Méthode B — en local (dépôt cloné)

```bash
git clone https://github.com/Arubinu/boardgames-planner.git
cd boardgames-planner
docker compose up -d --build
```

Le site est disponible sur le port que tu as mappé (par ex. **http://localhost:3001**).
L'administration est sur **…/admin.html**.

Au tout premier lancement, la base est automatiquement initialisée avec les deux lieux officiels (Salle Festive et Local de la MJC, avec leurs coordonnées), une sélection d'exemple de **12 jeux** (dont quelques extensions) et deux soirées de démonstration. La base est persistée dans le dossier `./data` (monté en volume), elle survit donc aux redémarrages et reconstructions.

Pour arrêter : `docker compose down` (les données restent dans `./data`).

### Configuration par variables d'environnement

Deux familles de variables, toutes prises en compte **à chaque démarrage** du conteneur.

**Opérationnelles** (lues directement depuis l'environnement) :

| Variable | Rôle | Défaut |
| --- | --- | --- |
| `LOGIN_RETRY_DELAY` | Délai minimal (en secondes) avant de pouvoir réessayer après une connexion admin **échouée**, par adresse IP. `0` = désactivé. | `10` |
| `PORT` | Port d'écoute interne du serveur (dans Docker, on mappe plutôt le port côté hôte). | `3000` |
| `DATA_DIR` | Dossier de la base SQLite. | `./data` |

**De réglage** (écrasent la valeur stockée en base si renseignées ; absentes ou vides → valeur **inchangée**) :

| Variable | Rôle |
| --- | --- |
| `ADMIN_PASSWORD` | (Re)définit le mot de passe administrateur, haché en Argon2id. |
| `MYLUDO_PROFILE` | Profil MyLudo public. |
| `WHATSAPP_MAIN` / `WHATSAPP_MJC` | Liens d'inscription WhatsApp. |

> `ADMIN_PASSWORD` est actif par défaut. Pour activer `MYLUDO_PROFILE`,
> `WHATSAPP_MAIN` ou `WHATSAPP_MJC`, décommente l'entrée correspondante du tableau
> `ENV_SETTINGS` dans `server/db.js`.

---

## Démarrage sans Docker (Node.js)

> Prérequis : Node.js 18 ou plus récent.

```bash
npm install        # installe les dépendances (front + serveur)
npm run build      # construit le front (Vite + Sass) → dossier public/
npm run seed       # initialise la base + sélection d'exemple (au 1er lancement)
npm start          # démarre le serveur sur http://localhost:3000
```

Pour le développement front avec rechargement à chaud, lancez le serveur API
(`npm run dev:server`) puis Vite (`npm run dev`) : Vite relaie les appels `/api`
vers Express.

Variables d'environnement utiles (prises en compte **à chaque démarrage**) :
- `PORT` : port d'écoute (défaut `3000`).
- `ADMIN_PASSWORD` : mot de passe admin. S'il est renseigné, il **(re)définit** le
  mot de passe à chaque démarrage (haché automatiquement en Argon2id) ; s'il est
  absent, le mot de passe stocké reste inchangé. Une base existante avec un ancien
  mot de passe en clair est migrée toute seule.
- `DATA_DIR` : dossier de la base SQLite (défaut `./data`).
- `LOGIN_RETRY_DELAY` : délai (en secondes) avant de réessayer après une connexion
  admin échouée (`0` = désactivé, défaut = `10`).

### Moteur SQLite

Le projet utilise **better-sqlite3** (rapide, stable, recommandé). S'il n'est pas
installable dans votre environnement, le serveur bascule automatiquement sur le
module natif **`node:sqlite`** (intégré à Node 22+). Aucune action requise de
votre part — dans Docker, c'est better-sqlite3 qui est utilisé.

---

## Identifiants par défaut

- **Mot de passe administration : `admin`**

Changez-le dès la mise en ligne, soit via `ADMIN_PASSWORD` (appliqué à chaque
démarrage), soit dans l'onglet **Réglages** de l'administration.

Le mot de passe n'est **jamais stocké en clair** : il est haché avec **Argon2id**
(paramètres conformes aux recommandations OWASP). La vérification se fait par
comparaison de hachage, et toute mise à jour du mot de passe est re-hachée avant
enregistrement.

> Si `ADMIN_PASSWORD` est renseigné dans `docker-compose.yml`, il a la priorité à
> chaque démarrage : un mot de passe modifié via l'interface sera réécrasé au
> prochain redémarrage. Pour gérer le mot de passe uniquement depuis l'interface,
> laissez `ADMIN_PASSWORD` non renseigné (commenté).

---

## Importer votre collection depuis MyLudo

1. Connectez-vous sur [myludo.fr](https://www.myludo.fr) et ouvrez votre ludothèque.
2. Exportez votre collection au format **CSV** ou **JSON** (fonction d'export de MyLudo).
3. Dans l'administration → onglet **Jeux & import**, glissez le fichier dans la zone prévue.
4. Choisissez le mode :
   - **Remplacer** : efface la collection actuelle et la remplace entièrement.
   - **Mettre à jour / compléter (fusion)** : ajoute les nouveaux jeux et met à jour
     les existants, **sans toucher** aux images et « apporté par » que vous avez saisis.
5. Cliquez sur **Importer**.

> Le profil MyLudo public configuré par défaut est `christophe-t-81487`
> (modifiable dans l'onglet Réglages). MyLudo ne fournit pas d'API d'images :
> les liens pointent vers la fiche du jeu, et vous pouvez ajouter une image
> personnalisée par jeu si vous le souhaitez.

---

## Structure du projet

```
boardgames-planner/
├── src/                    # sources front-end (compilées par Vite)
│   ├── pages/              # index.html, jeux.html, admin.html (sans <style>)
│   ├── scripts/
│   │   ├── shared/         # modules communs (api, dom, cartes, vignettes, modale)
│   │   │   ├── i18n.js     # moteur de traduction (sans dépendance)
│   │   │   ├── eventTypes.js  # registre runtime des types de soirées (chargé depuis l'API)
│   │   │   └── locales/    # dictionnaires de langue (fr.js, en.js)
│   │   └── pages/          # logique propre à chaque page (home, games, admin)
│   ├── styles/             # SCSS organisé en partials (_variables, _base, …)
├── static/                 # copiés à la racine du site (favicons, manifeste, /assets/…)
├── server/
│   ├── index.js            # serveur Express : API REST + service des pages + helmet
│   ├── db.js               # base SQLite + schéma + migrations + types de soirées + config d'environnement + hachage du mot de passe
│   ├── password.js         # hachage / vérification Argon2id
│   ├── myludo.js           # analyse des exports MyLudo (CSV et JSON)
│   └── seed.js             # initialisation : 2 lieux, sélection de 12 jeux, soirées démo
├── public/                 # SORTIE du build Vite (générée — non versionnée)
├── import-data/            # collection MyLudo d'exemple (CSV + JSON)
├── data/                   # base SQLite (créée au lancement — non versionnée)
├── vite.config.js          # configuration de build (3 pages, proxy /api en dev)
├── Dockerfile
└── docker-compose.yml
```

> Le dossier `public/` est **généré** par `npm run build` ; il n'est pas
> versionné. Dans Docker, le build est exécuté pendant la construction de
> l'image, donc rien à faire manuellement.

---

## Multilingue (i18n)

Le site est disponible en **français** (langue par défaut) et en **anglais**, sans
aucune dépendance externe. Un petit moteur maison (`src/scripts/shared/i18n.js`)
gère :
- la **détection** de la langue au premier chargement (préférence enregistrée,
  sinon langue du navigateur, sinon français) et sa **mémorisation** dans le
  `localStorage` du visiteur ;
- la mise à jour de l'attribut `<html lang>` et le formatage **localisé des dates**
  (`fr-FR` / `en-GB`) ;
- les textes statiques via des attributs déclaratifs dans le HTML
  (`data-i18n`, `data-i18n-html`, `data-i18n-ph`, `data-i18n-aria`) ;
- les textes générés en JavaScript (cartes, tableaux, messages) via les fonctions
  `t()` (avec interpolation `{var}`) et `tp()` (pluriel via `Intl.PluralRules`) ;
- un sélecteur de langue dans chaque barre de navigation, qui rafraîchit
  immédiatement tout le contenu de la page.

### Ajouter une langue

1. Créez `src/scripts/shared/locales/xx.js` en copiant `fr.js` et traduisez les
   valeurs (en conservant les clés et les variantes `_one` / `_other`).
2. Dans `i18n.js`, importez le dictionnaire, ajoutez-le à `DICTS`, à `LANGUAGES`
   (code + libellé court affiché) et à `LOCALES` (code de formatage des dates).

C'est tout : le sélecteur, la détection et les pages reprennent automatiquement la
nouvelle langue.

---

## Sauvegarde

Toutes les données tiennent dans le fichier `data/boardgames-planner.db`. Pour
sauvegarder, copiez simplement ce fichier (idéalement serveur arrêté, ou
copiez aussi les fichiers `-wal`/`-shm` s'ils existent).

---

## Licence

[MIT](LICENSE)
