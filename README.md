# 🎲 Boardgames Planner - Appointment Planner for Board Games

*__Read this in:__ English | [Français](README.fr.md)*

Website for the board game events of MJC Estrablin: a calendar of upcoming dates, a browsable game library (MyLudo collection) and an admin area to manage events, venues and games.

No external database: everything is stored in a single **SQLite** file.

The front-end is built with **Vite** (JS module bundling) and **Sass/SCSS** (styles organized per file, with no `<style>` tags in the HTML). An **Express** server then serves the compiled output. The admin password is stored **hashed with Argon2id** (per OWASP recommendations).

<img width="1124" height="2220" alt="screenshot" src="https://github.com/user-attachments/assets/af015741-b199-4a8e-ae41-2fbf1f8af605" />

---

## What the site does

**For visitors** (single scrolling page):
- Library preview + a dedicated `/games.html` page with search, filters (base games / expansions) and sorting by rating.
- Practical info, venues, contact and **WhatsApp** sign-up links for the events that offer it.
- **Membership section**: download the membership form (PDF) to fill in and pay on site.
- **Add to calendar**: from the practical info section, download the upcoming events as an `.ics` file, or copy the feed link for an auto-updating subscription (Google/Apple/Outlook "add by URL").
- **Interactive calendar**: the legend is **dynamic** (only the events types present in the displayed month appear, with their color). Clicking a event card re-centers the calendar on its date and shows the venue on a **mini-map** (OpenStreetMap); the "See this event's games" button opens the details. A past event with no recorded games shows a past-tense note rather than the "coming soon" one.
- **Multilingual** (French / English): a switcher in the navigation bar, language detected then remembered. See the dedicated section below.
- Light / dark theme.

**For administration** (`/admin.html`, password-protected):
- Create / edit / duplicate / delete events (shown in **two tables**: upcoming and past), choose their venue and tick the games available that evening.
- Manage **event types** from a dedicated tab: label, mention ("sign-up required"…), **color** and whether they offer WhatsApp sign-up. Types feed the event form, the calendar and the badges.
- Manage the list of venues (quick selection when creating a date). Each venue is **located by clicking on a Leaflet map** (OpenStreetMap): the coordinates are saved and the Google Maps link is derived automatically (no URL to paste). "Deleting" a venue **archives** it: it disappears from the public site but can be unarchived.
- Import the collection from a **MyLudo** export (CSV or JSON). Each game's **creation date** is preserved across imports; the modification date is updated.
- Add an image and a "brought by" note to each game (preserved across re-imports), or delete a game.
- Configure the **site identity**: the **name** and **holder** (e.g. "Game Nights" / "MJC Estrablin"), used to build the nav brand, the page titles and the share previews; plus the description and share image (OpenGraph), the **home title** (with `[highlighted]` parts) and the **footer text** (with `[label](url)` links).
- Set the **default site language** (or leave it on *auto / browser*), the WhatsApp links, the MyLudo profile and the password.

---

## Installing with Docker (recommended)

> Requirements: Docker and Docker Compose.

### Method A — a single `docker-compose.yml` (Dockge, Portainer, Komodo…)

**No need to clone the repository**: Docker can build the image directly from the
Git URL. In your stack manager (Dockge, Portainer…), create a new stack and paste
this `docker-compose.yml`:

```yaml
services:
  boardgames-planner:
    build: https://github.com/Arubinu/boardgames-planner.git
    container_name: boardgames-planner
    ports:
      - 3001:3000 # the site will be on http://IP:3001 (change the left number)
    volumes:
      - ./data:/app/data # persisted SQLite database
    environment:
      TRUST_PROXY: 1
      DEFAULT_LANG: ''
      #ADMIN_PASSWORD: admin
      #SITE_NAME: Boardgames Planner
      #SITE_TITLE: Boardgames Planner
      #SITE_DESCRIPTION: Board game night calendar, toy library, and practical information for the MJC Estrablin.
      #SITE_HOLDER: MJC Estrablin
      LOGIN_RETRY_DELAY: 10
      #MYLUDO_PROFILE: https://www.myludo.fr/#!/profil/[...]
      #ICS_FILENAME: boardgames-planner.ics
    healthcheck:
      test: ['CMD', 'wget', '-qO-', 'http://localhost:3000/healthz']
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 20s
    restart: unless-stopped
```

The tool builds the image from the repository's `Dockerfile`, then starts the
container. To **update** to the latest version, trigger a rebuild (a "rebuild"
button, or `docker compose up -d --build` in a terminal): Docker re-clones the Git
URL and rebuilds the image.

### Method B — locally (cloned repository)

```bash
git clone https://github.com/Arubinu/boardgames-planner.git
cd boardgames-planner
docker compose up -d --build
```

The site is available on the port you mapped (e.g. **http://localhost:3001**).
Administration is at **…/admin.html**.

On the very first launch, the database is automatically initialized with the two official venues (Salle Festive and Local de la MJC, with their coordinates), a sample selection of **12 games** (including a few expansions) and two demo events. The database is persisted in the `./data` folder (mounted as a volume), so it survives restarts and rebuilds.

To stop: `docker compose down` (data stays in `./data`).

### Configuration via environment variables

Two families of variables, all taken into account **on every startup** of the container.

**Operational** (read directly from the environment):

| Variable | Role | Default |
| --- | --- | --- |
| `TRUST_PROXY` | Number of trusted proxies for the `X-Forwarded-*` headers (`1` by default, `false` to disable, or a CIDR). |
| `LOGIN_RETRY_DELAY` | Minimum delay (in seconds) before retrying after a **failed** admin login, per IP address. `0` = disabled. | `10` |
| `PORT` | Server's internal listening port (in Docker, you usually map the host port instead). | `3000` |
| `DATA_DIR` | SQLite database folder. | `./data` |

**Settings** (overwrite the value stored in the database when set; absent or empty → value **unchanged**):

| Variable | Role |
| --- | --- |
| `ADMIN_PASSWORD` | (Re)defines the admin password, hashed with Argon2id. |
| `DEFAULT_LANG` | Site default language (`fr`, `en`, …; empty = browser detection). |
| `SITE_NAME` | Site name (nav brand, page titles, share previews). |
| `SITE_HOLDER` | Site holder (nav brand and footer copyright). |
| `SITE_TITLE` | Home (hero) title; `[text]` for highlighted parts. |
| `SITE_DESCRIPTION` | Site description (share previews / SEO). |
| `OG_IMAGE` | Open Graph share image (URL or `/assets/…` path). |
| `MYLUDO_PROFILE` | Public MyLudo profile. |
| `FOOTER_TEXT` | Footer text; links in `[label](url)` format. |
| `ICS_FILENAME` | Filename of the downloaded `.ics` calendar. |

> `ADMIN_PASSWORD` is handled separately (hashed). All the other variables above
> are wired in the `ENV_SETTINGS` table in `server/db.js`: just set them in the
> environment and they apply on every startup.

---

## Running without Docker (Node.js)

> Requirements: Node.js 18 or newer.

```bash
npm install        # install dependencies (front + server)
npm run build      # build the front-end (Vite + Sass) → public/ folder
npm run seed       # initialize the database + sample selection (first launch)
npm start          # start the server on http://localhost:3000
```

For front-end development with hot reload, start the API server
(`npm run dev:server`) then Vite (`npm run dev`): Vite proxies `/api` calls to
Express.

Useful environment variables (taken into account **on every startup**):
- `PORT`: listening port (default `3000`).
- `ADMIN_PASSWORD`: admin password. If it is set, it **(re)defines** the password
  on each startup (automatically hashed with Argon2id); if it is absent, the
  stored password stays unchanged. An existing database with an old plaintext
  password is migrated automatically.
- `DATA_DIR`: SQLite database folder (default `./data`).
- `LOGIN_RETRY_DELAY`: delay (in seconds) before retrying after a failed admin
  login (`0` = disabled, default = `10`).

### SQLite engine

The project uses **better-sqlite3** (fast, stable, recommended). If it cannot be
installed in your environment, the server automatically falls back to the native
**`node:sqlite`** module (built into Node 22+). No action required on your
side — inside Docker, better-sqlite3 is used.

---

## Default credentials

- **Admin password: `admin`**

Change it as soon as you go live, either via `ADMIN_PASSWORD` (applied on every
startup) or in the **Settings** tab of the administration.

The password is **never stored in plaintext**: it is hashed with **Argon2id**
(parameters following OWASP recommendations). Verification is done by hash
comparison, and any password update is re-hashed before being saved.

> If `ADMIN_PASSWORD` is set in `docker-compose.yml`, it takes priority on every
> startup: a password changed via the interface will be overwritten on the next
> restart. To manage the password only from the interface, leave `ADMIN_PASSWORD`
> unset (commented out).

---

## Importing your collection from MyLudo

1. Sign in at [myludo.fr](https://www.myludo.fr) and open your library.
2. Export your collection as **CSV** or **JSON** (MyLudo's export feature).
3. In the administration → **Games & import** tab, drop the file into the dedicated area.
4. Choose the mode:
   - **Replace**: clears the current collection and replaces it entirely.
   - **Update / complete (merge)**: adds new games and updates existing ones,
     **without touching** the images and "brought by" notes you entered.
5. Click **Import**.

> The default public MyLudo profile is `christophe-t-81487` (editable in the
> Settings tab). MyLudo does not provide an image API: links point to the game's
> page, and you can add a custom image per game if you wish.

---

## Project structure

```
boardgames-planner/
├── src/                    # front-end sources (compiled by Vite)
│   ├── pages/              # index.html, games.html, admin.html (no <style>)
│   ├── scripts/
│   │   ├── shared/         # shared modules (api, dom, maps, thumbnails, modal)
│   │   │   ├── i18n.js     # translation engine (dependency-free)
│   │   │   ├── eventTypes.js  # runtime registry of event types (loaded from the API)
│   │   │   └── locales/    # language dictionaries (fr.js, en.js)
│   │   └── pages/          # per-page logic (home, games, admin)
│   ├── styles/             # SCSS organized into partials (_variables, _base, …)
├── static/                 # copied to the site root (favicons, manifest, /assets/…)
├── server/
│   ├── index.js            # Express server: REST API + page serving + helmet
│   ├── db.js               # SQLite database + schema + migrations + event types + env config + password hashing
│   ├── password.js         # Argon2id hashing / verification
│   ├── myludo.js           # MyLudo export parsing (CSV and JSON)
│   └── seed.js             # initialization: 2 venues, 12-game selection, demo events
├── public/                 # OUTPUT of the Vite build (generated — not versioned)
├── import-data/            # sample MyLudo collection (CSV + JSON)
├── data/                   # SQLite database (created at launch — not versioned)
├── vite.config.js          # build configuration (3 pages, /api proxy in dev)
├── Dockerfile
└── docker-compose.yml
```

> The `public/` folder is **generated** by `npm run build`; it is not versioned.
> In Docker, the build runs during the image build, so there is nothing to do
> manually.

> The PWA manifest (`static/site.webmanifest`) and the favicons are plain files,
> not managed by the app: edit `site.webmanifest` in a text editor (app name,
> theme/background colors, icons) and replace the favicon images to match your
> own branding.

---

## Multilingual (i18n)

The site is available in **French** (default language) and **English**, with no
external dependency. A small in-house engine (`src/scripts/shared/i18n.js`)
handles:
- **detection** of the language on first load (saved preference, otherwise the
  **site default language** set in the admin, otherwise the browser language,
  otherwise French) and its **persistence** in the visitor's `localStorage`;
- updating the `<html lang>` attribute and **localized date formatting**
  (`fr-FR` / `en-GB`);
- a **per-language week start** for the calendar (`weekStart`: 1 = Monday for
  French, 0 = Sunday for English);
- static texts via declarative attributes in the HTML
  (`data-i18n`, `data-i18n-html`, `data-i18n-ph`, `data-i18n-aria`);
- texts generated in JavaScript (cards, tables, messages) via the functions
  `t()` (with `{var}` interpolation) and `tp()` (plural via `Intl.PluralRules`);
- a language switcher in each navigation bar, which immediately refreshes all the
  page content.

### Adding a language

1. Create `src/scripts/shared/locales/xx.js` by copying `fr.js` and translate the
   values (keeping the keys and the `_one` / `_other` variants; keep `cal.dow` in
   Sunday→Saturday order and set `cal.weekStart`, 0 = Sunday or 1 = Monday).
2. In `i18n.js`, import the dictionary and add it to `DICTS`, to `LANGUAGES`
   (code + short displayed label) and to `LOCALES` (date formatting code).

That's all: the switcher, the detection and the pages automatically pick up the
new language.

---

## Backup

All data fits in the `data/boardgames-planner.db` file. To back it up, simply
copy this file (ideally with the server stopped, or also copy the `-wal`/`-shm`
files if they exist).

---

## License

[MIT](LICENSE)
