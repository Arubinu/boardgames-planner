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
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
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

// Correctif des icônes de marqueur Leaflet sous bundler (Vite).
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png';
import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';
L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
});

let PWD = sessionStorage.getItem('admin_pwd') || '';
let GAMES = [];
let LOCATIONS = [];
let ALL_LOCATIONS = [];
let EVENTS = [];
let EVENT_TYPES = [];
let pickerSelected = new Set();
let pendingFile = null;

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
function populateTypeSelect() {
  const sel = document.getElementById('ef-type');
  if (!sel) return;
  const cur = sel.value || defaultType();
  sel.innerHTML = eventTypeOrder()
    .map((type) => `<option value="${type}">${esc(typeOption(type))}</option>`)
    .join('');
  sel.value = typeKey(cur);
}

async function openEventForm(id, opts = {}) {
  const duplicate = !!opts.duplicate;
  const locSel = document.getElementById('ef-location');
  locSel.innerHTML =
    `<option value="">${t('admin.ef_location_none')}</option>` +
    LOCATIONS.map((l) => `<option value="${l.id}">${esc(l.name)}</option>`).join('');
  populateTypeSelect();
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
    document.getElementById('ef-wa').value = e.whatsapp_url;
    e.games.forEach((g) => pickerSelected.add(g.id));
  } else {
    document.getElementById('ef-title').textContent = t('admin.ef_new');
    ['ef-id', 'ef-title-in', 'ef-date', 'ef-start', 'ef-end', 'ef-desc', 'ef-wa'].forEach(
      (i) => (document.getElementById(i).value = '')
    );
    document.getElementById('ef-type').value = defaultType();
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
    whatsapp_url: document.getElementById('ef-wa').value.trim(),
    game_ids: [...pickerSelected],
  };
  if (!payload.title || !payload.date) {
    toast(t('admin.err_title_date'), true);
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
function setupCoordMap(initialCoords) {
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
    populateDefaultLangSelect(s.default_lang);
    document.getElementById('set-site-title').value = s.site_title || '';
    document.getElementById('set-footer-text').value = s.footer_text || '';
    setSiteIdentity(s.site_name, s.site_holder);
    document.getElementById('set-wa-main').value = s.whatsapp_main || '';
    document.getElementById('set-wa-mjc').value = s.whatsapp_mjc || '';
    document.getElementById('set-myludo').value = s.myludo_profile || '';
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
    default_lang: document.getElementById('set-default-lang').value,
    site_title: document.getElementById('set-site-title').value.trim(),
    footer_text: document.getElementById('set-footer-text').value.trim(),
    whatsapp_main: document.getElementById('set-wa-main').value.trim(),
    whatsapp_mjc: document.getElementById('set-wa-mjc').value.trim(),
    myludo_profile: document.getElementById('set-myludo').value.trim(),
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

// --- Changement de langue : rafraîchit le contenu dynamique --------------
function onLanguageChanged() {
  if (!dashboardVisible()) return;
  populateTypeSelect();
  renderEventsTable();
  renderGamesTable();
  renderLocationsTables();
  renderEventTypesTable();
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
  document.getElementById('login-btn').addEventListener('click', doLogin);
  document.getElementById('login-pwd').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') doLogin();
  });

  document.querySelectorAll('.tab').forEach((tab) =>
    tab.addEventListener('click', () => switchTab(tab.dataset.tab, tab))
  );

  document.getElementById('new-event-btn').addEventListener('click', () => openEventForm());
  document.getElementById('new-location-btn').addEventListener('click', () => openLocationForm());
  document.getElementById('new-type-btn')?.addEventListener('click', () => openEventTypeForm());
  document.getElementById('save-type-btn')?.addEventListener('click', saveEventType);
  document.getElementById('ef-type').addEventListener('change', onTypeChange);
  document.getElementById('gp-search').addEventListener('input', renderPicker);
  document.getElementById('save-event-btn').addEventListener('click', saveEvent);
  document.getElementById('save-location-btn').addEventListener('click', saveLocation);
  document.getElementById('save-game-btn').addEventListener('click', saveGame);
  document.getElementById('save-settings-btn').addEventListener('click', saveSettings);
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
      '[data-edit-event],[data-dup-event],[data-del-event],[data-edit-game],[data-del-game],[data-edit-loc],[data-del-loc],[data-unarchive-loc],[data-edit-type],[data-del-type]'
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
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  initI18n();
  applyI18n(document);
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
