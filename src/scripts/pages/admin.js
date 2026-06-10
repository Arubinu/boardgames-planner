// scripts/pages/admin.js
// Panneau d'administration : connexion, gestion des soirées, des jeux,
// import MyLudo, gestion des lieux (avec sélection des coordonnées par clic
// sur une carte Leaflet) et réglages.
//
// Tous les libellés visibles passent désormais par l'i18n et les types de
// soirées par eventTypes.js (plus de « Grande/Petite soirée » en dur). Un menu
// mobile (burger) permet de quitter l'administration depuis un téléphone, à
// l'identique du reste du site.
import '../../styles/admin.scss';
import { API } from '../shared/api.js';
import { esc, initTheme, toggleTheme, toast, openModal, closeModal } from '../shared/dom.js';
import {
  initI18n,
  applyI18n,
  mountLangSwitchers,
  onLangChange,
  t,
  tp,
  getLocale,
  LANGUAGES,
  setSiteIdentity,
  applySiteDefaultLang,
} from '../shared/i18n.js';
import {
  setEventTypes,
  eventTypeOrder,
  defaultType,
  typeKey,
  typeLabel,
  typeShort,
  typeOption,
  typeColor,
} from '../shared/eventTypes.js';

// Carte Leaflet (sélection des coordonnées d'un lieu) : chargée à la demande
// pour ne pas bloquer le rendu initial. Les images de marqueur restent des
// imports statiques (simples URLs).
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png';
import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';

let L = null; // instance Leaflet, peuplée au premier usage
let leafletReady = null;
function ensureLeaflet() {
  if (!leafletReady) {
    leafletReady = Promise.all([
      import('leaflet'),
      import('leaflet/dist/leaflet.css'),
    ]).then(([mod]) => {
      L = mod.default;
      // Correctif des icônes de marqueur Leaflet sous bundler (Vite).
      L.Icon.Default.mergeOptions({
        iconRetinaUrl: markerIcon2x,
        iconUrl: markerIcon,
        shadowUrl: markerShadow,
      });
      return L;
    });
  }
  return leafletReady;
}

let PWD = sessionStorage.getItem('admin_pwd') || '';
let GAMES = [];
let LOCATIONS = [];
let ALL_LOCATIONS = [];
let EVENTS = [];
let EVENT_TYPES = [];
let pickerSelected = new Set();
let pendingFile = null;

// État « Infos pratiques ».
let INFO_BLOCKS = [];
let FAQ_ITEMS = [];
let MEMBERSHIP_FILES = [];
let pendingDocs = null; // FileList sélectionnée mais pas encore envoyée

// Palette d'émojis « génériques », rendus de façon homogène sur tous les
// navigateurs (jeu d'émojis ancien et largement pris en charge). Sert au
// sélecteur d'émoji des blocs d'information.
const EMOJI_CHOICES = [
  '📅','🗓️','📍','🗺️','💬','✉️','📧','📞','☎️','🏠','🏛️','🚗','🅿️','ℹ️','❓','❗',
  '⭐','✅','🎲','🃏','🎯','🎉','🎮','🧩','🍕','🍻','☕','👥','👋','🔗','📣','📌',
  '📎','📝','📋','💡','⏰','🕐','🎨','🏆','🎁','🔔','📢','🤝','😀','🌟','♟️','🎟️',
];

// État de la carte de sélection de coordonnées (modale lieu).
let coordMap = null;
let coordMarker = null;
let coordValue = ''; // "lat,lon"

// Centre par défaut de la carte : Estrablin.
const ESTRABLIN = [45.5161, 4.9583];

// --- Suppression / archivage (modale unifiée) ----------------------------
// La configuration est résolue à l'appel (et non au chargement) pour que les
// libellés suivent la langue courante.
const DELETE_CONFIG = {
  event: {
    title: () => t('admin.del_event_title'),
    msg: (label) => t('admin.del_event_msg', { label: esc(label) }),
    confirmKey: 'admin.delete',
    url: (id) => '/api/admin/events/' + id,
    method: 'DELETE',
    done: () => t('admin.del_event_done'),
    reload: () =>
      loadEvents().then(() => (document.getElementById('stat-events').textContent = EVENTS.length)),
  },
  game: {
    title: () => t('admin.del_game_title'),
    msg: (label) => t('admin.del_game_msg', { label: esc(label) }),
    confirmKey: 'admin.delete',
    url: (id) => '/api/admin/games/' + id,
    method: 'DELETE',
    done: () => t('admin.del_game_done'),
    reload: () =>
      loadGames().then(() => (document.getElementById('stat-games').textContent = GAMES.length)),
  },
  location: {
    title: () => t('admin.del_loc_title'),
    msg: (label) => t('admin.del_loc_msg', { label: esc(label) }),
    confirmKey: 'admin.archive',
    url: (id) => '/api/admin/locations/' + id,
    method: 'DELETE',
    done: () => t('admin.del_loc_done'),
    reload: () =>
      loadLocations().then(
        () => (document.getElementById('stat-locations').textContent = LOCATIONS.length)
      ),
  },
  eventType: {
    title: () => t('admin.del_type_title'),
    msg: (label) => t('admin.del_type_msg', { label: esc(label) }),
    confirmKey: 'admin.delete',
    url: (id) => '/api/admin/event-types/' + id,
    method: 'DELETE',
    done: () => t('admin.del_type_done'),
    reload: () =>
      loadEventTypes().then(() => {
        populateTypeSelect();
        renderEventsTable();
      }),
  },
  infoBlock: {
    title: () => t('admin.del_block_title'),
    msg: (label) => t('admin.del_block_msg', { label: esc(label) }),
    confirmKey: 'admin.delete',
    url: (id) => '/api/admin/info-blocks/' + id,
    method: 'DELETE',
    done: () => t('admin.del_block_done'),
    reload: () => loadInfoBlocks(),
  },
  faq: {
    title: () => t('admin.del_faq_title'),
    msg: (label) => t('admin.del_faq_msg', { label: esc(label) }),
    confirmKey: 'admin.delete',
    url: (id) => '/api/admin/faq/' + id,
    method: 'DELETE',
    done: () => t('admin.del_faq_done'),
    reload: () => loadFaq(),
  },
  membershipDoc: {
    title: () => t('admin.del_doc_title'),
    msg: (label) => t('admin.del_doc_msg', { label: esc(label) }),
    confirmKey: 'admin.delete',
    url: (id) => '/api/admin/membership/' + id,
    method: 'DELETE',
    done: () => t('admin.del_doc_done'),
    reload: () => loadMembership(),
  },
};

function confirmDelete(kind, id, label) {
  const cfg = DELETE_CONFIG[kind];
  if (!cfg) return;
  document.getElementById('cm-title').textContent = cfg.title();
  document.getElementById('cm-message').innerHTML = cfg.msg(label);
  const btn = document.getElementById('cm-confirm-btn');
  btn.textContent = t(cfg.confirmKey);
  btn.onclick = async () => {
    try {
      await API.send(cfg.url(id), cfg.method, null, PWD);
      closeModal('confirm-modal');
      toast(cfg.done());
      cfg.reload();
    } catch (e) {
      toast(e.message, true);
    }
  };
  openModal('confirm-modal');
}

// --- Authentification -----------------------------------------------------
async function doLogin() {
  const pwd = document.getElementById('login-pwd').value;
  try {
    await API.send('/api/admin/login', 'POST', { password: pwd });
    PWD = pwd;
    sessionStorage.setItem('admin_pwd', pwd);
    showDashboard();
  } catch (e) {
    if (e.status === 429) {
      toast(t('admin.login_wait', { n: e.retryAfter ?? '' }), true);
    } else {
      toast(t('admin.login_bad'), true);
    }
  }
}
function logout() {
  PWD = '';
  sessionStorage.removeItem('admin_pwd');
  location.reload();
}
function showDashboard() {
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('dashboard').style.display = 'block';
  document.getElementById('logout-btn').style.display = 'inline-flex';
  loadAll();
}
function switchTab(name, el) {
  document.querySelectorAll('.tab').forEach((tab) => tab.classList.remove('active'));
  document.querySelectorAll('.panel').forEach((p) => p.classList.remove('active'));
  el.classList.add('active');
  document.getElementById('panel-' + name).classList.add('active');
}

function dashboardVisible() {
  return document.getElementById('dashboard')?.style.display === 'block';
}

async function loadAll() {
  await loadEventTypes();
  await Promise.all([loadEvents(), loadGames(), loadLocations()]);
  loadSettings();
  loadInfoBlocks();
  loadFaq();
  loadMembership();
  document.getElementById('stat-events').textContent = EVENTS.length;
  document.getElementById('stat-games').textContent = GAMES.length;
  document.getElementById('stat-locations').textContent = LOCATIONS.length;
}

// --- Soirées --------------------------------------------------------------
async function loadEvents() {
  EVENTS = await API.get('/api/events');
  renderEventsTable();
}
function renderEventsTable() {
  const eventRow = (e) => `<tr>
      <td data-label="${t('admin.th_event')}"><strong>${esc(e.title)}</strong><br><span class="muted" style="font-size:.82rem">${esc(
        e.date
      )}</span></td>
      <td data-label="${t('admin.th_type')}"><span class="badge" style="background:${typeColor(
      e.type
    )};color:#fff">${esc(typeShort(e.type))}</span></td>
      <td data-label="${t('admin.th_location')}">${esc(e.location_name || t('admin.dash'))}</td>
      <td data-label="${t('admin.th_games')}">${tp('admin.games_unit', e.games_count)}</td>
      <td class="cell-actions"><div class="row-actions">
        <button class="btn btn-ghost btn-icon" data-edit-event="${e.id}"
          title="${t('admin.edit')}" aria-label="${t('admin.edit')}">
          <img src="/assets/icons/edit.svg" alt="" />
        </button>
        <button class="btn btn-ghost btn-icon" data-dup-event="${e.id}"
          title="${t('admin.duplicate')}" aria-label="${t('admin.duplicate')}">
          <img src="/assets/icons/copy.svg" alt="" />
        </button>
        <button class="btn btn-ghost btn-icon" data-del-event="${e.id}"
          title="${t('admin.delete')}" data-label-text="${esc(e.title)}">
          <img src="/assets/icons/delete.svg" alt="" />
        </button>
      </div></td></tr>`;

  const table = (list, emptyKey) =>
    list.length
      ? `<table class="responsive"><thead><tr><th>${t('admin.th_event')}</th><th>${t(
          'admin.th_type'
        )}</th><th>${t('admin.th_location')}</th><th>${t(
          'admin.th_games'
        )}</th><th></th></tr></thead><tbody>${list.map(eventRow).join('')}</tbody></table>`
      : `<div class="empty">${t(emptyKey)}</div>`;

  // EVENTS est trié par date croissante (API). On sépare à venir / passées.
  const today = new Date().toISOString().slice(0, 10);
  const upcoming = EVENTS.filter((e) => e.date >= today);
  const past = EVENTS.filter((e) => e.date < today).reverse(); // plus récentes d'abord

  document.getElementById('events-table').innerHTML = table(upcoming, 'admin.no_events');
  const pastEl = document.getElementById('past-events-table');
  if (pastEl) pastEl.innerHTML = table(past, 'admin.no_past_events');
}

// Remplit le sélecteur de type à partir du registre chargé depuis l'API.
// Avec { placeholder: true }, on ajoute une option vide « — Choisir un type — »
// sélectionnée par défaut : aucun type n'est présélectionné (cas création).
function populateTypeSelect({ placeholder = false } = {}) {
  const sel = document.getElementById('ef-type');
  if (!sel) return;
  const cur = sel.value;
  const opts = eventTypeOrder()
    .map((type) => `<option value="${type}">${esc(typeOption(type))}</option>`)
    .join('');
  sel.innerHTML = placeholder
    ? `<option value="" disabled selected hidden>${esc(t('admin.ef_type_none'))}</option>` + opts
    : opts;
  if (placeholder) {
    sel.value = '';
  } else {
    sel.value = typeKey(cur || defaultType());
  }
}

async function openEventForm(id, opts = {}) {
  const duplicate = !!opts.duplicate;
  const locSel = document.getElementById('ef-location');
  locSel.innerHTML =
    `<option value="">${t('admin.ef_location_none')}</option>` +
    LOCATIONS.map((l) => `<option value="${l.id}">${esc(l.name)}</option>`).join('');
  // Création « vierge » : aucun type présélectionné. En édition/duplication on
  // garde le type de l'évènement source, présélectionné juste après.
  populateTypeSelect({ placeholder: !id });
  pickerSelected = new Set();

  if (id) {
    const e = await API.get('/api/events/' + id);
    document.getElementById('ef-title').textContent = duplicate
      ? t('admin.ef_duplicate')
      : t('admin.ef_edit');
    document.getElementById('ef-id').value = duplicate ? '' : e.id;
    document.getElementById('ef-title-in').value = e.title;
    document.getElementById('ef-date').value = duplicate ? '' : e.date;
    document.getElementById('ef-type').value = typeKey(e.type);
    document.getElementById('ef-start').value = e.start_time;
    document.getElementById('ef-end').value = e.end_time;
    document.getElementById('ef-location').value = e.location_id || '';
    document.getElementById('ef-desc').value = e.description;
    e.games.forEach((g) => pickerSelected.add(g.id));
  } else {
    document.getElementById('ef-title').textContent = t('admin.ef_new');
    ['ef-id', 'ef-title-in', 'ef-date', 'ef-start', 'ef-end', 'ef-desc'].forEach(
      (i) => (document.getElementById(i).value = '')
    );
  }
  document.getElementById('gp-search').value = '';
  renderPicker();
  openModal('event-form-modal');
}

// Au changement de type, propose un titre par défaut uniquement si le champ
// est vide (on ne réécrit jamais un titre saisi par l'utilisateur).
function onTypeChange() {
  const titleEl = document.getElementById('ef-title-in');
  if (!titleEl.value.trim()) {
    titleEl.value = typeLabel(document.getElementById('ef-type').value);
  }
}

function renderPicker() {
  const q = document.getElementById('gp-search').value.trim().toLowerCase();
  const list = GAMES.filter((g) => !q || g.title.toLowerCase().includes(q)).slice(
    0,
    q ? 500 : GAMES.length
  );
  document.getElementById('game-picker').innerHTML = list
    .map(
      (g) => `
      <label class="gp-item">
        <input type="checkbox" value="${g.id}" ${pickerSelected.has(g.id) ? 'checked' : ''} data-pick="${
        g.id
      }">
        <span>${esc(g.title)}${
        g.type === 'extension' ? ` <span class="badge badge-petite">${t('game.ext_short')}</span>` : ''
      }</span>
      </label>`
    )
    .join('');
  document.getElementById('gp-count').textContent = pickerSelected.size;
}

async function saveEvent() {
  const payload = {
    title: document.getElementById('ef-title-in').value.trim(),
    date: document.getElementById('ef-date').value,
    type: document.getElementById('ef-type').value,
    start_time: document.getElementById('ef-start').value,
    end_time: document.getElementById('ef-end').value,
    location_id: document.getElementById('ef-location').value || null,
    description: document.getElementById('ef-desc').value.trim(),
    game_ids: [...pickerSelected],
  };
  if (!payload.title || !payload.date) {
    toast(t('admin.err_title_date'), true);
    return;
  }
  if (!payload.type) {
    toast(t('admin.err_type'), true);
    return;
  }
  const id = document.getElementById('ef-id').value;
  try {
    if (id) await API.send('/api/admin/events/' + id, 'PUT', payload, PWD);
    else await API.send('/api/admin/events', 'POST', payload, PWD);
    closeModal('event-form-modal');
    toast(t('admin.saved_event'));
    loadEvents().then(() => (document.getElementById('stat-events').textContent = EVENTS.length));
  } catch (e) {
    toast(e.message, true);
  }
}

// --- Jeux -----------------------------------------------------------------
async function loadGames() {
  GAMES = await API.get('/api/games');
  document.getElementById('games-count').textContent = GAMES.length;
  renderGamesTable();
}
function fmtDateTime(s) {
  if (!s) return t('admin.dash');
  const d = new Date(s.replace(' ', 'T'));
  if (isNaN(d)) return esc(s);
  return d.toLocaleDateString(getLocale(), { day: '2-digit', month: '2-digit', year: '2-digit' });
}
function renderGamesTable() {
  const q = document.getElementById('games-search').value.trim().toLowerCase();
  const list = GAMES.filter((g) => !q || g.title.toLowerCase().includes(q)).slice(0, 300);
  const rows = list
    .map(
      (g) => `<tr>
      <td data-label="${t('admin.th_game')}"><strong>${esc(g.title)}</strong>${
        g.type === 'extension' ? ` <span class="badge badge-petite">${t('game.ext_short')}</span>` : ''
      }<br><span class="muted" style="font-size:.8rem">${esc(g.players || '')} · ${esc(
        g.duration || ''
      )} ${t('game.min')}</span></td>
      <td data-label="${t('admin.th_rating')}">${g.rating > 0 ? '★ ' + g.rating.toFixed(1) : t('admin.dash')}</td>
      <td data-label="${t('admin.th_image')}">${g.image_url ? '🖼️' : t('admin.dash')}</td>
      <td data-label="${t('admin.th_owner')}">${esc(g.owner || t('admin.dash'))}</td>
      <td data-label="${t('admin.th_dates')}"><span class="muted" style="font-size:.8rem">${fmtDateTime(
        g.created_at
      )}<br>${fmtDateTime(g.updated_at)}</span></td>
      <td class="cell-actions"><div class="row-actions">
        <button class="btn btn-ghost btn-icon" data-edit-game="${g.id}"
          title="${t('admin.edit')}" aria-label="${t('admin.edit')}">
          <img src="/assets/icons/edit.svg" alt="" />
        </button>
        <a class="btn btn-ghost btn-icon" href="${esc(g.details_url)}"
          title="${t('admin.details')}" aria-label="${t('admin.details')}"
          target="_blank" rel="noopener">
          <img src="/assets/icons/link.svg" alt="" />
        </a>
        <button class="btn btn-ghost btn-icon" data-del-game="${g.id}"
          title="${t('admin.delete')}" data-label-text="${esc(g.title)}">
          <img src="/assets/icons/delete.svg" alt="" />
        </button>
      </div></td></tr>`
    )
    .join('');
  document.getElementById('games-table').innerHTML = GAMES.length
    ? `<table class="responsive"><thead><tr><th>${t('admin.th_game')}</th><th>${t(
        'admin.th_rating'
      )}</th><th>${t('admin.th_image')}</th><th>${t('admin.th_owner')}</th><th>${t(
        'admin.th_dates'
      )}</th><th></th></tr></thead><tbody>${rows}</tbody></table>` +
      (list.length < GAMES.length && !q
        ? `<p class="help center">${t('admin.games_limited')}</p>`
        : '')
    : `<div class="empty">${t('admin.no_games')}</div>`;
}
function openGameForm(id) {
  const g = GAMES.find((x) => x.id === id);
  if (!g) return;
  document.getElementById('gf-title').textContent = g.title;
  document.getElementById('gf-id').value = g.id;
  document.getElementById('gf-image').value = g.image_url || '';
  document.getElementById('gf-owner').value = g.owner || '';
  openModal('game-form-modal');
}
async function saveGame() {
  const id = document.getElementById('gf-id').value;
  try {
    await API.send(
      '/api/admin/games/' + id,
      'PUT',
      {
        image_url: document.getElementById('gf-image').value.trim(),
        owner: document.getElementById('gf-owner').value.trim(),
      },
      PWD
    );
    closeModal('game-form-modal');
    toast(t('admin.saved_game'));
    loadGames();
  } catch (e) {
    toast(e.message, true);
  }
}

// --- Import ---------------------------------------------------------------
function fileChosen(input) {
  pendingFile = input.files[0] || null;
  document.getElementById('file-name').textContent = pendingFile
    ? t('admin.file_prefix', { name: pendingFile.name })
    : '';
  document.getElementById('import-btn').disabled = !pendingFile;
}
async function doImport() {
  if (!pendingFile) return;
  const mode = document.getElementById('import-mode').value;
  if (mode === 'replace') {
    document.getElementById('cm-title').textContent = t('admin.replace_title');
    document.getElementById('cm-message').innerHTML = t('admin.replace_msg');
    const btn = document.getElementById('cm-confirm-btn');
    btn.textContent = t('admin.replace_btn');
    btn.onclick = () => {
      closeModal('confirm-modal');
      runImport(mode);
    };
    openModal('confirm-modal');
  } else {
    runImport(mode);
  }
}
async function runImport(mode) {
  const fd = new FormData();
  fd.append('file', pendingFile);
  document.getElementById('import-btn').disabled = true;
  try {
    const r = await fetch('/api/admin/import?mode=' + mode, {
      method: 'POST',
      headers: { 'x-admin-password': PWD },
      body: fd,
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'Error');
    toast(t('admin.imported', { count: data.imported }));
    pendingFile = null;
    document.getElementById('file-name').textContent = '';
    document.getElementById('file-input').value = '';
    loadGames().then(() => (document.getElementById('stat-games').textContent = GAMES.length));
  } catch (e) {
    toast(e.message, true);
  } finally {
    document.getElementById('import-btn').disabled = false;
  }
}

// --- Lieux ----------------------------------------------------------------
async function loadLocations() {
  ALL_LOCATIONS = await API.send('/api/locations?include_archived=1', 'GET', null, PWD);
  LOCATIONS = ALL_LOCATIONS.filter((l) => !l.archived);
  renderLocationsTables();
}
function renderLocationsTables() {
  const active = LOCATIONS;
  const archived = ALL_LOCATIONS.filter((l) => l.archived);

  const coordsCell = (l) =>
    l.coords
      ? `<span class="muted" style="font-size:.82rem">${esc(l.coords)}</span>`
      : `<span class="muted">${t('admin.coords_undefined')}</span>`;

  const rows = active
    .map(
      (l) => `<tr>
      <td data-label="${t('admin.th_name')}"><strong>${esc(l.name)}</strong></td>
      <td data-label="${t('admin.th_address')}">${esc(l.address || t('admin.dash'))}</td>
      <td data-label="${t('admin.th_coords')}">${coordsCell(l)}</td>
      <td class="cell-actions"><div class="row-actions">
        <button class="btn btn-ghost btn-icon" data-edit-loc="${l.id}"
          title="${t('admin.edit')}" aria-label="${t('admin.edit')}">
          <img src="/assets/icons/edit.svg" alt="" />
        </button>
        <button class="btn btn-ghost btn-icon" data-del-loc="${l.id}"
          title="${t('admin.archive')}" data-label-text="${esc(l.name)}">
          <img src="/assets/icons/archive.svg" alt="" />
        </button>
      </div></td></tr>`
    )
    .join('');
  document.getElementById('locations-table').innerHTML = active.length
    ? `<table class="responsive"><thead><tr><th>${t('admin.th_name')}</th><th>${t(
        'admin.th_address'
      )}</th><th>${t('admin.th_coords')}</th><th></th></tr></thead><tbody>${rows}</tbody></table>`
    : `<div class="empty">${t('admin.no_active_loc')}</div>`;

  const arows = archived
    .map(
      (l) => `<tr>
      <td data-label="${t('admin.th_name')}"><span class="muted">${esc(l.name)}</span></td>
      <td data-label="${t('admin.th_address')}" class="muted">${esc(l.address || t('admin.dash'))}</td>
      <td class="cell-actions">
        <button class="btn btn-ghost btn-icon" data-unarchive-loc="${l.id}"
          title="${t('admin.unarchive')}" aria-label="${t('admin.unarchive')}">
          <img src="/assets/icons/unarchive.svg" alt="" />
        </button>
      </td>
    </tr>`
    )
    .join('');
  document.getElementById('archived-locations-table').innerHTML = archived.length
    ? `<table class="responsive"><thead><tr><th>${t('admin.th_name')}</th><th>${t(
        'admin.th_address'
      )}</th><th></th></tr></thead><tbody>${arows}</tbody></table>`
    : `<div class="empty">${t('admin.no_archived_loc')}</div>`;
}

async function unarchiveLocation(id) {
  try {
    await API.send('/api/admin/locations/' + id + '/unarchive', 'POST', null, PWD);
    toast(t('admin.unarchived'));
    loadLocations().then(
      () => (document.getElementById('stat-locations').textContent = LOCATIONS.length)
    );
  } catch (e) {
    toast(e.message, true);
  }
}

// Initialise (ou réinitialise) la carte de sélection des coordonnées.
async function setupCoordMap(initialCoords) {
  await ensureLeaflet();
  coordValue = initialCoords || '';
  const start = parseLatLon(initialCoords) || ESTRABLIN;

  if (!coordMap) {
    coordMap = L.map('coord-map').setView(start, 16);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© OpenStreetMap',
    }).addTo(coordMap);
    // Clic sur la carte = placement du marqueur + enregistrement des coords.
    coordMap.on('click', (e) => placeCoordMarker(e.latlng.lat, e.latlng.lng));
  } else {
    coordMap.setView(start, 16);
  }

  // Marqueur initial éventuel.
  if (coordMarker) {
    coordMap.removeLayer(coordMarker);
    coordMarker = null;
  }
  const ll = parseLatLon(initialCoords);
  if (ll) placeCoordMarker(ll[0], ll[1]);
  updateCoordReadout();

  // Leaflet a besoin d'un recalcul de taille quand la modale s'ouvre.
  setTimeout(() => coordMap.invalidateSize(), 200);
}

function placeCoordMarker(lat, lon) {
  coordValue = `${lat.toFixed(7)},${lon.toFixed(7)}`;
  if (coordMarker) coordMarker.setLatLng([lat, lon]);
  else coordMarker = L.marker([lat, lon]).addTo(coordMap);
  updateCoordReadout();
}

function updateCoordReadout() {
  document.getElementById('lf-coords-readout').textContent = coordValue
    ? t('admin.lf_coords', { coords: coordValue })
    : t('admin.lf_coords_prompt');
}

function parseLatLon(value) {
  if (!value) return null;
  const p = String(value).split(',').map((s) => parseFloat(s.trim()));
  return p.length === 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]) ? p : null;
}

function openLocationForm(id) {
  if (id) {
    const l = LOCATIONS.find((x) => x.id === id);
    document.getElementById('lf-title').textContent = t('admin.lf_edit');
    document.getElementById('lf-id').value = l.id;
    document.getElementById('lf-name').value = l.name;
    document.getElementById('lf-address').value = l.address;
    document.getElementById('lf-desc').value = l.description;
    openModal('location-form-modal');
    setupCoordMap(l.coords);
  } else {
    document.getElementById('lf-title').textContent = t('admin.lf_new');
    ['lf-id', 'lf-name', 'lf-address', 'lf-desc'].forEach(
      (i) => (document.getElementById(i).value = '')
    );
    openModal('location-form-modal');
    setupCoordMap('');
  }
}

async function saveLocation() {
  const payload = {
    name: document.getElementById('lf-name').value.trim(),
    address: document.getElementById('lf-address').value.trim(),
    coords: coordValue,
    description: document.getElementById('lf-desc').value.trim(),
  };
  if (!payload.name) {
    toast(t('admin.err_name'), true);
    return;
  }
  const id = document.getElementById('lf-id').value;
  try {
    if (id) await API.send('/api/admin/locations/' + id, 'PUT', payload, PWD);
    else await API.send('/api/admin/locations', 'POST', payload, PWD);
    closeModal('location-form-modal');
    toast(t('admin.saved_location'));
    loadLocations().then(
      () => (document.getElementById('stat-locations').textContent = LOCATIONS.length)
    );
  } catch (e) {
    toast(e.message, true);
  }
}

// --- Types de soirées -----------------------------------------------------
async function loadEventTypes() {
  EVENT_TYPES = await API.get('/api/event-types');
  setEventTypes(EVENT_TYPES);
  renderEventTypesTable();
}

function renderEventTypesTable() {
  const el = document.getElementById('types-table');
  if (!el) return;
  const rows = EVENT_TYPES.map(
    (ty) => `<tr>
      <td data-label="${t('admin.th_type_label')}">
        <span class="badge" style="background:${ty.color};color:#fff">${esc(ty.label)}</span>
      </td>
      <td data-label="${t('admin.th_type_sub')}">${esc(ty.sub || t('admin.dash'))}</td>
      <td data-label="${t('admin.th_type_signup')}">${
        ty.signup ? t('admin.yes') : t('admin.no')
      }</td>
      <td class="cell-actions"><div class="row-actions">
        <button class="btn btn-ghost btn-icon" data-edit-type="${ty.id}"
          title="${t('admin.edit')}" aria-label="${t('admin.edit')}">
          <img src="/assets/icons/edit.svg" alt="" />
        </button>
        <button class="btn btn-ghost btn-icon" data-del-type="${ty.id}"
          title="${t('admin.delete')}" data-label-text="${esc(ty.label)}">
          <img src="/assets/icons/delete.svg" alt="" />
        </button>
      </div></td>
    </tr>`
  ).join('');
  el.innerHTML = EVENT_TYPES.length
    ? `<table class="responsive"><thead><tr><th>${t('admin.th_type_label')}</th><th>${t(
        'admin.th_type_sub'
      )}</th><th>${t('admin.th_type_signup')}</th><th></th></tr></thead><tbody>${rows}</tbody></table>`
    : `<div class="empty">${t('admin.no_types')}</div>`;
}

function openEventTypeForm(id) {
  const ty = id ? EVENT_TYPES.find((x) => x.id === id) : null;
  document.getElementById('tf-title').textContent = ty
    ? t('admin.tf_edit')
    : t('admin.tf_new');
  document.getElementById('tf-id').value = ty ? ty.id : '';
  document.getElementById('tf-label').value = ty ? ty.label : '';
  document.getElementById('tf-sub').value = ty ? ty.sub : '';
  document.getElementById('tf-color').value = ty ? ty.color : '#8b9a6b';
  document.getElementById('tf-signup').checked = ty ? !!ty.signup : false;
  openModal('type-form-modal');
}

async function saveEventType() {
  const payload = {
    label: document.getElementById('tf-label').value.trim(),
    sub: document.getElementById('tf-sub').value.trim(),
    color: document.getElementById('tf-color').value,
    signup: document.getElementById('tf-signup').checked ? 1 : 0,
  };
  if (!payload.label) {
    toast(t('admin.err_type_label'), true);
    return;
  }
  const id = document.getElementById('tf-id').value;
  try {
    if (id) await API.send('/api/admin/event-types/' + id, 'PUT', payload, PWD);
    else await API.send('/api/admin/event-types', 'POST', payload, PWD);
    closeModal('type-form-modal');
    toast(t('admin.saved_type'));
    await loadEventTypes();
    populateTypeSelect();
    renderEventsTable();
  } catch (e) {
    toast(e.message, true);
  }
}

// --- Réglages -------------------------------------------------------------
async function loadSettings() {
  try {
    const s = await API.send('/api/admin/settings', 'GET', null, PWD);
    document.getElementById('set-site-name').value = s.site_name || '';
    document.getElementById('set-site-holder').value = s.site_holder || '';
    document.getElementById('set-site-desc').value = s.site_description || '';
    document.getElementById('set-og-image').value = s.og_image || '';
    document.getElementById('set-meta-keywords').value = s.meta_keywords || '';
    populateDefaultLangSelect(s.default_lang);
    document.getElementById('set-site-title').value = s.site_title || '';
    document.getElementById('set-footer-text').value = s.footer_text || '';
    document.getElementById('set-footer-year').value = s.footer_year || '';
    setSiteIdentity(s.site_name, s.site_holder);
    // Champs « Infos pratiques » (onglet dédié).
    document.getElementById('ip-infos-title').value = s.infos_title || '';
    document.getElementById('ip-infos-sub').value = s.infos_sub || '';
    document.getElementById('ip-cal-enabled').checked = s.calendar_enabled !== '0';
    document.getElementById('ip-ics-filename').value = s.ics_filename || '';
    document.getElementById('ip-join-title').value = s.join_title || '';
    document.getElementById('ip-join-text').value = s.join_text || '';
  } catch {}
}

// Remplit la liste « Langue par défaut du site » : « Auto (navigateur) » puis
// une entrée par langue disponible. Reconstruit à chaque ouverture des réglages.
function populateDefaultLangSelect(selected) {
  const sel = document.getElementById('set-default-lang');
  if (!sel) return;
  sel.innerHTML =
    `<option value="">${esc(t('admin.lang_auto'))}</option>` +
    LANGUAGES.map((l) => `<option value="${l.code}">${esc(l.label)}</option>`).join('');
  sel.value = selected || '';
}
async function saveSettings() {
  const payload = {
    site_name: document.getElementById('set-site-name').value.trim(),
    site_holder: document.getElementById('set-site-holder').value.trim(),
    site_description: document.getElementById('set-site-desc').value.trim(),
    og_image: document.getElementById('set-og-image').value.trim(),
    meta_keywords: document.getElementById('set-meta-keywords').value.trim(),
    default_lang: document.getElementById('set-default-lang').value,
    site_title: document.getElementById('set-site-title').value.trim(),
    footer_text: document.getElementById('set-footer-text').value.trim(),
    footer_year: document.getElementById('set-footer-year').value.trim(),
  };
  const np = document.getElementById('set-pwd').value.trim();
  if (np) payload.admin_password = np;
  try {
    await API.send('/api/admin/settings', 'PUT', payload, PWD);
    if (np) {
      PWD = np;
      sessionStorage.setItem('admin_pwd', np);
      document.getElementById('set-pwd').value = '';
    }
    toast(t('admin.saved_settings'));
  } catch (e) {
    toast(e.message, true);
  }
}

// =========================================================================
//  INFOS PRATIQUES (blocs, agenda, adhésion, FAQ)
// =========================================================================

// Réordonnancement : déplace l'élément `id` d'un cran puis persiste l'ordre.
function moveAndPersist(arr, id, dir, url, rerender) {
  const i = arr.findIndex((x) => x.id === id);
  const j = dir === 'up' ? i - 1 : i + 1;
  if (i < 0 || j < 0 || j >= arr.length) return;
  [arr[i], arr[j]] = [arr[j], arr[i]];
  rerender();
  API.send(url, 'PUT', { ids: arr.map((x) => x.id) }, PWD).catch((e) => toast(e.message, true));
}

// Boutons monter/descendre communs aux listes ordonnables.
function moveButtons(attr, id, index, total) {
  return `
    <button class="btn btn-ghost btn-icon" data-${attr}="${id}" data-dir="up" ${
    index === 0 ? 'disabled' : ''
  } title="${t('admin.move_up')}" aria-label="${t('admin.move_up')}">▲</button>
    <button class="btn btn-ghost btn-icon" data-${attr}="${id}" data-dir="down" ${
    index === total - 1 ? 'disabled' : ''
  } title="${t('admin.move_down')}" aria-label="${t('admin.move_down')}">▼</button>`;
}

function fmtSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}

// --- Blocs d'information --------------------------------------------------
async function loadInfoBlocks() {
  INFO_BLOCKS = await API.get('/api/info-blocks');
  renderInfoBlocksTable();
}

function renderInfoBlocksTable() {
  const el = document.getElementById('info-blocks-table');
  if (!el) return;
  const rows = INFO_BLOCKS.map((b, i) => {
    const del = `<button class="btn btn-ghost btn-icon" data-del-ib="${b.id}" title="${t(
      'admin.delete'
    )}" data-label-text="${esc(b.title)}"><img src="/assets/icons/delete.svg" alt="" /></button>`;
    return `<tr>
      <td data-label="${t('admin.ip_th_emoji')}" style="font-size:1.4rem">${esc(b.icon)}</td>
      <td data-label="${t('admin.ip_th_block')}"><strong>${esc(b.title)}</strong></td>
      <td class="cell-actions"><div class="row-actions">
        ${moveButtons('move-ib', b.id, i, INFO_BLOCKS.length)}
        <button class="btn btn-ghost btn-icon" data-edit-ib="${b.id}" title="${t(
      'admin.edit'
    )}" aria-label="${t('admin.edit')}"><img src="/assets/icons/edit.svg" alt="" /></button>
        ${del}
      </div></td>
    </tr>`;
  }).join('');
  el.innerHTML = INFO_BLOCKS.length
    ? `<table class="responsive"><thead><tr><th>${t('admin.ip_th_emoji')}</th><th>${t(
        'admin.ip_th_block'
      )}</th><th></th></tr></thead><tbody>${rows}</tbody></table>`
    : `<div class="empty">${t('admin.ip_no_blocks')}</div>`;
}

let selectedEmoji = '📌';
function renderEmojiGrid() {
  const grid = document.getElementById('ib-emoji-grid');
  if (!grid) return;
  grid.innerHTML = EMOJI_CHOICES.map(
    (e) =>
      `<button type="button" class="emoji-btn${
        e === selectedEmoji ? ' selected' : ''
      }" data-emoji="${e}">${e}</button>`
  ).join('');
  document.getElementById('ib-icon-preview').textContent = selectedEmoji;
}

function openInfoBlockForm(id) {
  const b = id ? INFO_BLOCKS.find((x) => x.id === id) : null;
  document.getElementById('ibf-title').textContent = b
    ? t('admin.ibf_edit')
    : t('admin.ibf_new');
  document.getElementById('ib-id').value = b ? b.id : '';
  document.getElementById('ib-title-in').value = b ? b.title : '';
  document.getElementById('ib-body').value = b ? b.body : '';
  selectedEmoji = b ? b.icon || '📌' : '📌';
  renderEmojiGrid();
  openModal('infoblock-form-modal');
}

async function saveInfoBlock() {
  const payload = {
    icon: selectedEmoji,
    title: document.getElementById('ib-title-in').value.trim(),
    body: document.getElementById('ib-body').value,
  };
  if (!payload.title) {
    toast(t('admin.err_block_title'), true);
    return;
  }
  const id = document.getElementById('ib-id').value;
  try {
    if (id) await API.send('/api/admin/info-blocks/' + id, 'PUT', payload, PWD);
    else await API.send('/api/admin/info-blocks', 'POST', payload, PWD);
    closeModal('infoblock-form-modal');
    toast(t('admin.saved_block'));
    loadInfoBlocks();
  } catch (e) {
    toast(e.message, true);
  }
}

// --- Questions fréquentes -------------------------------------------------
async function loadFaq() {
  FAQ_ITEMS = await API.get('/api/faq');
  renderFaqTable();
}

function renderFaqTable() {
  const el = document.getElementById('faq-table');
  if (!el) return;
  const rows = FAQ_ITEMS.map(
    (f, i) => `<tr>
      <td data-label="${t('admin.ip_th_question')}"><strong>${esc(f.question)}</strong></td>
      <td class="cell-actions"><div class="row-actions">
        ${moveButtons('move-faq', f.id, i, FAQ_ITEMS.length)}
        <button class="btn btn-ghost btn-icon" data-edit-faq="${f.id}" title="${t(
      'admin.edit'
    )}" aria-label="${t('admin.edit')}"><img src="/assets/icons/edit.svg" alt="" /></button>
        <button class="btn btn-ghost btn-icon" data-del-faq="${f.id}" title="${t(
      'admin.delete'
    )}" data-label-text="${esc(f.question)}"><img src="/assets/icons/delete.svg" alt="" /></button>
      </div></td>
    </tr>`
  ).join('');
  el.innerHTML = FAQ_ITEMS.length
    ? `<table class="responsive"><thead><tr><th>${t(
        'admin.ip_th_question'
      )}</th><th></th></tr></thead><tbody>${rows}</tbody></table>`
    : `<div class="empty">${t('admin.ip_no_faq')}</div>`;
}

function openFaqForm(id) {
  const f = id ? FAQ_ITEMS.find((x) => x.id === id) : null;
  document.getElementById('faqf-title').textContent = f
    ? t('admin.faqf_edit')
    : t('admin.faqf_new');
  document.getElementById('faqf-id').value = f ? f.id : '';
  document.getElementById('faqf-question').value = f ? f.question : '';
  document.getElementById('faqf-answer').value = f ? f.answer : '';
  openModal('faq-form-modal');
}

async function saveFaq() {
  const payload = {
    question: document.getElementById('faqf-question').value.trim(),
    answer: document.getElementById('faqf-answer').value,
  };
  if (!payload.question) {
    toast(t('admin.err_faq_question'), true);
    return;
  }
  const id = document.getElementById('faqf-id').value;
  try {
    if (id) await API.send('/api/admin/faq/' + id, 'PUT', payload, PWD);
    else await API.send('/api/admin/faq', 'POST', payload, PWD);
    closeModal('faq-form-modal');
    toast(t('admin.saved_faq'));
    loadFaq();
  } catch (e) {
    toast(e.message, true);
  }
}

// --- Document(s) d'adhésion -----------------------------------------------
async function loadMembership() {
  MEMBERSHIP_FILES = await API.send('/api/admin/membership', 'GET', null, PWD);
  renderMembershipTable();
}

function renderMembershipTable() {
  const el = document.getElementById('membership-table');
  if (!el) return;
  if (!MEMBERSHIP_FILES.length) {
    el.innerHTML = `<div class="empty">${t('admin.ip_no_docs')}</div>`;
    return;
  }
  const fmt = MEMBERSHIP_FILES.length > 1 ? 'ZIP' : '';
  const summary = `<p class="help" style="margin:0 0 .6rem">${esc(
    t('admin.ip_docs_summary', {
      count: MEMBERSHIP_FILES.length,
      format: fmt || t('admin.ip_docs_single'),
    })
  )}</p>`;
  const rows = MEMBERSHIP_FILES.map(
    (f, i) => `<tr>
      <td data-label="${t('admin.ip_th_file')}"><strong>${esc(f.original_name)}</strong></td>
      <td data-label="${t('admin.ip_th_size')}">${esc(fmtSize(f.size))}</td>
      <td class="cell-actions"><div class="row-actions">
        ${moveButtons('move-doc', f.id, i, MEMBERSHIP_FILES.length)}
        <button class="btn btn-ghost btn-icon" data-del-doc="${f.id}" title="${t(
      'admin.delete'
    )}" data-label-text="${esc(f.original_name)}"><img src="/assets/icons/delete.svg" alt="" /></button>
      </div></td>
    </tr>`
  ).join('');
  el.innerHTML =
    summary +
    `<table class="responsive"><thead><tr><th>${t('admin.ip_th_file')}</th><th>${t(
      'admin.ip_th_size'
    )}</th><th></th></tr></thead><tbody>${rows}</tbody></table>`;
}

async function uploadDocs() {
  if (!pendingDocs || !pendingDocs.length) {
    document.getElementById('ip-doc-input').click();
    return;
  }
  const fd = new FormData();
  for (const f of pendingDocs) fd.append('files', f);
  try {
    const r = await fetch('/api/admin/membership', {
      method: 'POST',
      headers: { 'x-admin-password': PWD },
      body: fd,
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || r.statusText);
    pendingDocs = null;
    document.getElementById('ip-doc-input').value = '';
    document.getElementById('ip-doc-chosen').textContent = '';
    toast(t('admin.uploaded_docs', { count: data.added }));
    loadMembership();
  } catch (e) {
    toast(e.message, true);
  }
}

// --- Export / Import de la base -------------------------------------------
const BK_COUNT_KEYS = {
  settings: 'settings',
  event_types: 'event_types',
  locations: 'locations',
  games: 'games',
  events: 'events',
  info_blocks: 'info_blocks',
  faq: 'faq',
  membership: 'membership_files',
};

function clearBackupPreview() {
  document.querySelectorAll('.bk-count').forEach((el) => (el.textContent = ''));
  ['bk-list-locations', 'bk-list-info_blocks'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = '';
  });
}

function renderBkList(id, names) {
  const el = document.getElementById(id);
  if (!el) return;
  const items = (names || []).filter((n) => n && String(n).trim());
  el.innerHTML = items.length
    ? `<ul>${items.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>`
    : '';
}

async function previewBackup() {
  clearBackupPreview();
  const fileInput = document.getElementById('bk-file');
  const file = fileInput.files && fileInput.files[0];
  if (!file) return;
  let parsed;
  try {
    parsed = JSON.parse(await file.text());
  } catch {
    return toast(t('admin.bk_bad_preview'), true);
  }
  if (!parsed || parsed.type !== 'boardgames-planner-export' || !parsed.data) {
    return toast(t('admin.bk_bad_preview'), true);
  }
  const d = parsed.data;
  document.querySelectorAll('.bk-count').forEach((el) => {
    const arr = d[BK_COUNT_KEYS[el.dataset.count]];
    el.textContent = Array.isArray(arr) ? ` (${arr.length})` : '';
  });
  renderBkList('bk-list-locations', (d.locations || []).map((l) => l.name));
  renderBkList('bk-list-info_blocks', (d.info_blocks || []).map((b) => b.title));
}

async function doExport() {
  try {
    const r = await fetch('/api/admin/db-export', { headers: { 'x-admin-password': PWD } });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.statusText);
    const blob = await r.blob();
    const cd = r.headers.get('Content-Disposition') || '';
    const m = cd.match(/filename="([^"]+)"/);
    const name = m ? m[1] : 'boardgames-planner.json';
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast(t('admin.bk_exported'));
  } catch (e) {
    toast(e.message, true);
  }
}

function doDbImport() {
  const fileInput = document.getElementById('bk-file');
  const file = fileInput.files && fileInput.files[0];
  const cats = [...document.querySelectorAll('.bk-cat:checked')].map((c) => c.value);
  if (!file) return toast(t('admin.bk_no_file'), true);
  if (!cats.length) return toast(t('admin.bk_no_cat'), true);

  // Confirmation (action destructive) via la modale partagée.
  document.getElementById('cm-title').textContent = t('admin.bk_confirm_title');
  document.getElementById('cm-message').innerHTML = t('admin.bk_confirm_msg', { count: cats.length });
  const btn = document.getElementById('cm-confirm-btn');
  btn.textContent = t('admin.bk_import_btn');
  btn.onclick = async () => {
    const fd = new FormData();
    fd.append('backup', file);
    fd.append('categories', JSON.stringify(cats));
    try {
      const r = await fetch('/api/admin/db-import', {
        method: 'POST',
        headers: { 'x-admin-password': PWD },
        body: fd,
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || r.statusText);
      closeModal('confirm-modal');
      // Réinitialise le formulaire d'import.
      fileInput.value = '';
      clearBackupPreview();
      document.querySelectorAll('.bk-cat').forEach((c) => (c.checked = false));
      const allBox = document.getElementById('bk-all');
      if (allBox) allBox.checked = false;
      toast(t('admin.bk_imported', { count: (data.imported || cats).length }));
      loadAll();
    } catch (e) {
      toast(e.message, true);
    }
  };
  openModal('confirm-modal');
}

// --- Enregistrement des réglages « Infos pratiques » ----------------------
async function saveInfosSettings(payload, okKey) {
  try {
    await API.send('/api/admin/settings', 'PUT', payload, PWD);
    toast(t(okKey));
  } catch (e) {
    toast(e.message, true);
  }
}
function saveInfosSection() {
  saveInfosSettings(
    {
      infos_title: document.getElementById('ip-infos-title').value.trim(),
      infos_sub: document.getElementById('ip-infos-sub').value.trim(),
    },
    'admin.saved_section'
  );
}
function saveCalendarBlock() {
  saveInfosSettings(
    {
      calendar_enabled: document.getElementById('ip-cal-enabled').checked ? '1' : '0',
      ics_filename: document.getElementById('ip-ics-filename').value.trim(),
    },
    'admin.saved_calendar'
  );
}
function saveJoinBlock() {
  saveInfosSettings(
    {
      join_title: document.getElementById('ip-join-title').value.trim(),
      join_text: document.getElementById('ip-join-text').value.trim(),
    },
    'admin.saved_join'
  );
}

// --- Changement de langue : rafraîchit le contenu dynamique --------------
function onLanguageChanged() {
  if (!dashboardVisible()) return;
  populateTypeSelect();
  renderEventsTable();
  renderGamesTable();
  renderLocationsTables();
  renderEventTypesTable();
  renderInfoBlocksTable();
  renderFaqTable();
  renderMembershipTable();
}

// --- Câblage des événements (aucun handler inline) -----------------------
function wireHandlers() {
  // Menu mobile : le burger ouvre/ferme la barre de navigation, comme sur le
  // reste du site (permet notamment de quitter l'administration sur mobile).
  document.querySelector('.nav-burger')?.addEventListener('click', () =>
    document.getElementById('navlinks')?.classList.toggle('open')
  );
  document.getElementById('navlinks')?.addEventListener('click', (e) => {
    if (e.target.closest('a')) document.getElementById('navlinks').classList.remove('open');
  });

  document.querySelectorAll('.theme-toggle').forEach((b) => b.addEventListener('click', toggleTheme));
  document.getElementById('logout-btn').addEventListener('click', logout);
  document.getElementById('login-form').addEventListener('submit', (e) => {
    e.preventDefault();
    doLogin();
  });

  document.querySelectorAll('.tab').forEach((tab) =>
    tab.addEventListener('click', () => switchTab(tab.dataset.tab, tab))
  );

  document.getElementById('new-event-btn').addEventListener('click', () => openEventForm());
  document.getElementById('new-location-btn').addEventListener('click', () => openLocationForm());
  document.getElementById('new-type-btn')?.addEventListener('click', () => openEventTypeForm());
  document.getElementById('save-type-btn')?.addEventListener('click', saveEventType);

  // Infos pratiques.
  document.getElementById('ip-save-section')?.addEventListener('click', saveInfosSection);
  document.getElementById('ip-save-calendar')?.addEventListener('click', saveCalendarBlock);
  document.getElementById('ip-save-join')?.addEventListener('click', saveJoinBlock);
  document.getElementById('ip-new-block')?.addEventListener('click', () => openInfoBlockForm());
  document.getElementById('save-infoblock-btn')?.addEventListener('click', saveInfoBlock);
  document.getElementById('ip-new-faq')?.addEventListener('click', () => openFaqForm());
  document.getElementById('save-faq-btn')?.addEventListener('click', saveFaq);
  // Sélecteur d'émoji (boutons générés).
  document.getElementById('ib-emoji-grid')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-emoji]');
    if (!btn) return;
    selectedEmoji = btn.dataset.emoji;
    renderEmojiGrid();
  });
  // Documents d'adhésion.
  document.getElementById('ip-upload-docs')?.addEventListener('click', uploadDocs);
  document.getElementById('ip-doc-input')?.addEventListener('change', (e) => {
    pendingDocs = e.target.files;
    const names = Array.from(pendingDocs || []).map((f) => f.name).join(', ');
    document.getElementById('ip-doc-chosen').textContent = names
      ? t('admin.ip_docs_chosen', { names })
      : '';
    if (pendingDocs && pendingDocs.length) uploadDocs();
  });
  document.getElementById('ef-type').addEventListener('change', onTypeChange);

  // Sauvegarde (export / import).
  document.getElementById('bk-export-btn')?.addEventListener('click', doExport);
  document.getElementById('bk-import-btn')?.addEventListener('click', doDbImport);
  document.getElementById('bk-file')?.addEventListener('change', previewBackup);
  document.getElementById('bk-all')?.addEventListener('change', (e) => {
    document.querySelectorAll('.bk-cat').forEach((c) => (c.checked = e.target.checked));
  });
  document.querySelectorAll('.bk-cat').forEach((c) =>
    c.addEventListener('change', () => {
      const all = [...document.querySelectorAll('.bk-cat')];
      const allBox = document.getElementById('bk-all');
      if (allBox) allBox.checked = all.every((x) => x.checked);
    })
  );
  document.getElementById('gp-search').addEventListener('input', renderPicker);
  document.getElementById('save-event-btn').addEventListener('click', saveEvent);
  document.getElementById('save-location-btn').addEventListener('click', saveLocation);
  document.getElementById('save-game-btn').addEventListener('click', saveGame);
  document.getElementById('settings-form').addEventListener('submit', (e) => {
    e.preventDefault();
    saveSettings();
  });
  document.getElementById('import-btn').addEventListener('click', doImport);
  document.getElementById('games-search').addEventListener('input', renderGamesTable);

  // Fermeture des modales.
  document.querySelectorAll('[data-close-modal]').forEach((b) =>
    b.addEventListener('click', () => closeModal(b.dataset.closeModal))
  );

  // Picker de jeux (cases à cocher générées).
  document.getElementById('game-picker').addEventListener('change', (e) => {
    const cb = e.target.closest('[data-pick]');
    if (!cb) return;
    const gid = Number(cb.dataset.pick);
    cb.checked ? pickerSelected.add(gid) : pickerSelected.delete(gid);
    document.getElementById('gp-count').textContent = pickerSelected.size;
  });

  // Zone de dépôt d'import.
  const dz = document.getElementById('dropzone');
  dz.addEventListener('click', () => document.getElementById('file-input').click());
  ['dragover', 'dragenter'].forEach((ev) =>
    dz.addEventListener(ev, (e) => {
      e.preventDefault();
      dz.classList.add('drag');
    })
  );
  ['dragleave', 'drop'].forEach((ev) =>
    dz.addEventListener(ev, (e) => {
      e.preventDefault();
      dz.classList.remove('drag');
    })
  );
  dz.addEventListener('drop', (e) => {
    const f = e.dataTransfer.files[0];
    if (f) {
      document.getElementById('file-input').files = e.dataTransfer.files;
      fileChosen(document.getElementById('file-input'));
    }
  });
  document.getElementById('file-input').addEventListener('change', (e) => fileChosen(e.target));

  // Délégation pour les tableaux (générés dynamiquement).
  document.getElementById('dashboard').addEventListener('click', (e) => {
    const el = e.target.closest(
      '[data-edit-event],[data-dup-event],[data-del-event],[data-edit-game],[data-del-game],[data-edit-loc],[data-del-loc],[data-unarchive-loc],[data-edit-type],[data-del-type],[data-edit-ib],[data-del-ib],[data-move-ib],[data-edit-faq],[data-del-faq],[data-move-faq],[data-del-doc],[data-move-doc]'
    );
    if (!el) return;
    if (el.dataset.editEvent) return openEventForm(Number(el.dataset.editEvent));
    if (el.dataset.dupEvent) return openEventForm(Number(el.dataset.dupEvent), { duplicate: true });
    if (el.dataset.delEvent)
      return confirmDelete('event', Number(el.dataset.delEvent), el.dataset.labelText);
    if (el.dataset.editGame) return openGameForm(Number(el.dataset.editGame));
    if (el.dataset.delGame)
      return confirmDelete('game', Number(el.dataset.delGame), el.dataset.labelText);
    if (el.dataset.editLoc) return openLocationForm(Number(el.dataset.editLoc));
    if (el.dataset.delLoc)
      return confirmDelete('location', Number(el.dataset.delLoc), el.dataset.labelText);
    if (el.dataset.unarchiveLoc) return unarchiveLocation(Number(el.dataset.unarchiveLoc));
    if (el.dataset.editType) return openEventTypeForm(Number(el.dataset.editType));
    if (el.dataset.delType)
      return confirmDelete('eventType', Number(el.dataset.delType), el.dataset.labelText);
    // Infos pratiques.
    if (el.dataset.editIb) return openInfoBlockForm(Number(el.dataset.editIb));
    if (el.dataset.delIb)
      return confirmDelete('infoBlock', Number(el.dataset.delIb), el.dataset.labelText);
    if (el.dataset.moveIb)
      return moveAndPersist(
        INFO_BLOCKS,
        Number(el.dataset.moveIb),
        el.dataset.dir,
        '/api/admin/info-blocks/reorder',
        renderInfoBlocksTable
      );
    if (el.dataset.editFaq) return openFaqForm(Number(el.dataset.editFaq));
    if (el.dataset.delFaq)
      return confirmDelete('faq', Number(el.dataset.delFaq), el.dataset.labelText);
    if (el.dataset.moveFaq)
      return moveAndPersist(
        FAQ_ITEMS,
        Number(el.dataset.moveFaq),
        el.dataset.dir,
        '/api/admin/faq/reorder',
        renderFaqTable
      );
    if (el.dataset.delDoc)
      return confirmDelete('membershipDoc', Number(el.dataset.delDoc), el.dataset.labelText);
    if (el.dataset.moveDoc)
      return moveAndPersist(
        MEMBERSHIP_FILES,
        Number(el.dataset.moveDoc),
        el.dataset.dir,
        '/api/admin/membership/reorder',
        renderMembershipTable
      );
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  initI18n();
  applyI18n(document);
  applySiteDefaultLang();
  mountLangSwitchers();
  initTheme();
  wireHandlers();
  onLangChange(onLanguageChanged);
  if (PWD) {
    try {
      await API.send('/api/admin/login', 'POST', { password: PWD });
      showDashboard();
    } catch {
      sessionStorage.removeItem('admin_pwd');
      PWD = '';
    }
  }
});
