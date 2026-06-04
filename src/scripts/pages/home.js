// scripts/pages/home.js
// Logique de la page d'accueil : événements, calendrier interactif (avec
// légende dynamique selon les types présents dans le mois affiché), mini-carte
// basée sur les coordonnées du lieu, aperçu de la ludothèque, infos + FAQ.
import '../../styles/home.scss';
import { API } from '../shared/api.js';
import { esc, isUpcoming, initTheme, toggleTheme, openModal, closeModal, toast } from '../shared/dom.js';
import {
  initI18n,
  applyI18n,
  mountLangSwitchers,
  onLangChange,
  t,
  tp,
  tRaw,
  formatDate,
  formatMonthYear,
  formatMonthShort,
} from '../shared/i18n.js';
import {
  eventTypeOrder,
  setEventTypes,
  typeKey,
  typeLabel,
  typeSub,
  typeColor,
  typeSignup,
} from '../shared/eventTypes.js';
import { gameThumb, wireThumbFallbacks } from '../shared/gameThumb.js';
import { openGameModal } from '../shared/gameModal.js';
import { parseCoords, googleMapsUrl } from '../shared/maps.js';
// Mini-carte en Leaflet (remplace l'ancien iframe d'embed OpenStreetMap, dont
// le pied de page n'était pas personnalisable car servi en cross-origin).
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
// Correctif des icônes de marqueur Leaflet sous bundler (Vite).
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png';
import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';
L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
});

let SETTINGS = {};
let ALL_EVENTS = [];
let LOCS = [];
let GAMES_COUNT = null;
const GAMES_BY_ID = {};

// Instance Leaflet de la mini-carte (réutilisée d'un événement à l'autre).
let homeMap = null;
let homeMarker = null;

// --- Navigation interne ---
function goto(id) {
  document.getElementById('navlinks')?.classList.remove('open');
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
}

// --- Événements -----------------------------------------------------------
function eventCardHtml(e) {
  const d = new Date(e.date + 'T12:00:00');
  const day = d.getDate();
  const month = formatMonthShort(e.date);
  const time = e.start_time ? `${e.start_time}${e.end_time ? '–' + e.end_time : ''}` : '';
  return `<div class="card event-card fade-in" data-event="${e.id}">
    <div class="event-date-chip" style="background:${typeColor(e.type)}">
      <div><div class="day">${day}</div><div style="text-transform:uppercase;font-size:.8rem">${esc(
    month
  )}</div></div>
      <div><span class="badge" style="background:rgba(255,255,255,.25);color:#fff">${esc(typeLabel(e.type))}</span></div>
    </div>
    <div class="event-body">
      <h3>${esc(e.title)}</h3>
      ${time ? `<div class="event-meta">🕐 ${esc(time)}</div>` : ''}
      ${e.location_name ? `<div class="event-meta">📍 ${esc(e.location_name)}</div>` : ''}
      <div class="event-meta">🎲 ${esc(tp('event.games_count', e.games_count))}</div>
    </div>
  </div>`;
}

async function loadEvents() {
  try {
    ALL_EVENTS = await API.get('/api/events');
    renderEvents();
    initCalendar();
    revealObserve();
  } catch (e) {
    document.getElementById('events-container').innerHTML = `<div class="empty">${esc(
      t('dates.load_error', { error: e.message })
    )}</div>`;
  }
}

// (Re)construit les listes de cartes (à venir + passées). Appelable au
// changement de langue.
function renderEvents() {
  if (!ALL_EVENTS.length && !document.getElementById('events-container')) return;
  const upcoming = ALL_EVENTS.filter((e) => isUpcoming(e.date));
  // Soirées passées : on ne garde qu'un an en arrière (borne basse).
  const oneYearAgo = new Date();
  oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
  const minPastDate = ymd(oneYearAgo);
  const past = ALL_EVENTS.filter(
    (e) => !isUpcoming(e.date) && e.date >= minPastDate
  ).reverse();
  const cont = document.getElementById('events-container');
  if (cont)
    cont.innerHTML = upcoming.length
      ? `<div class="events-grid">${upcoming
          .slice(0, 3)
          .map(eventCardHtml)
          .join('')}</div>`
      : `<div class="empty">${esc(t('dates.none_upcoming'))}</div>`;
  const pastEl = document.getElementById('past-events');
  if (pastEl)
    pastEl.innerHTML = past.length
      ? `<div class="events-grid">${past.map(eventCardHtml).join('')}</div>`
      : `<div class="empty">${esc(t('dates.none_past'))}</div>`;
  revealObserve();
}

// --- Calendrier interactif + mini-carte ----------------------------------
let calCursor = null;
let selectedDate = null;
const ymd = (d) => d.toISOString().slice(0, 10);
const eventByDate = (date) => ALL_EVENTS.find((e) => e.date === date);

function initCalendar() {
  const today = ymd(new Date());
  const sorted = [...ALL_EVENTS].sort((a, b) => a.date.localeCompare(b.date));
  const next = sorted.find((e) => e.date >= today);
  const def = next ? next.date : sorted.length ? sorted[sorted.length - 1].date : today;
  selectedDate = def;
  const d = new Date(def + 'T12:00:00');
  calCursor = new Date(d.getFullYear(), d.getMonth(), 1);
  renderCalendar();
  updateMap(selectedDate);
}
function calPrev() {
  calCursor.setMonth(calCursor.getMonth() - 1);
  renderCalendar();
}
function calNext() {
  calCursor.setMonth(calCursor.getMonth() + 1);
  renderCalendar();
}

function renderCalendar() {
  const monthEl = document.getElementById('cal-month');
  const grid = document.getElementById('cal-grid');
  if (!monthEl || !grid || !calCursor) return;
  monthEl.textContent = formatMonthYear(calCursor);
  const today = ymd(new Date());
  const year = calCursor.getFullYear();
  const month = calCursor.getMonth();
  const first = new Date(year, month, 1);
  const startCol = (first.getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const dow = tRaw('cal.dow') || [];
  const typesInMonth = new Set();

  let html = dow.map((d) => `<div class="cal-dow">${esc(d)}</div>`).join('');
  for (let i = 0; i < startCol; i++) html += '<div class="cal-day empty"></div>';
  for (let day = 1; day <= daysInMonth; day++) {
    const date = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const ev = eventByDate(date);
    const isPast = date < today;
    const cls = ['cal-day'];
    let dayStyle = '';
    if (ev) {
      cls.push('has-event');
      dayStyle = ` style="background:${typeColor(ev.type)}"`;
      typesInMonth.add(typeKey(ev.type));
    }
    if (isPast) cls.push('past');
    if (date === today) cls.push('today');
    if (date === selectedDate) cls.push('selected');
    const attr = ev ? ` data-date="${date}"` : '';
    html += `<div class="${cls.join(' ')}"${attr}${dayStyle} title="${ev ? esc(ev.title) : ''}">${day}</div>`;
  }
  grid.innerHTML = html;
  renderLegend(typesInMonth);
}

// Légende dynamique : n'affiche que les types réellement présents dans le mois
// affiché (dans l'ordre canonique), pour éviter une liste interminable.
function renderLegend(typesInMonth) {
  const legend = document.getElementById('cal-legend');
  if (!legend) return;
  const types = eventTypeOrder().filter((tp) => typesInMonth.has(tp));
  legend.innerHTML = types
    .map(
      (tp) =>
        `<span><i class="dot" style="background:${typeColor(tp)}"></i> ${esc(typeLabel(tp))}</span>`
    )
    .join('');
  legend.style.display = types.length ? '' : 'none';
}

function selectDate(date) {
  selectedDate = date;
  renderCalendar();
  updateMap(date);
}

// Clic sur une carte de soirée : on amène le calendrier sur le mois concerné,
// on sélectionne la date et on fait défiler jusqu'au calendrier. La modale,
// elle, reste accessible via le bouton « Voir les jeux de cette soirée ».
function focusEventInCalendar(ev) {
  const d = new Date(ev.date + 'T12:00:00');
  calCursor = new Date(d.getFullYear(), d.getMonth(), 1);
  selectedDate = ev.date;
  renderCalendar();
  updateMap(ev.date);
  document.getElementById('cal-map')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

// Détruit proprement la mini-carte Leaflet (avant d'afficher un message ou de
// vider le panneau), pour éviter conteneurs orphelins et fuites mémoire.
function destroyLocationMap() {
  if (homeMap) {
    homeMap.remove();
    homeMap = null;
    homeMarker = null;
  }
}

// Affiche la mini-carte Leaflet sur les coordonnées du lieu. La carte est
// créée une seule fois puis recentrée d'un événement à l'autre. L'attribution
// est réduite à un court « © OpenStreetMap » et le lien « Leaflet » est retiré
// (voir le complément SCSS pour réduire encore la taille de ce texte).
function renderLocationMap(embed, coords) {
  // Si le panneau contenait autre chose (message « coordonnées manquantes »
  // ou panneau vidé), on recrée le conteneur de carte.
  if (!document.getElementById('map-leaflet')) {
    destroyLocationMap();
    embed.innerHTML =
      '<div id="map-leaflet" style="width:100%;height:100%;min-height:240px"></div>';
  }
  const center = [coords.lat, coords.lon];
  if (!homeMap) {
    homeMap = L.map('map-leaflet').setView(center, 15);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© OpenStreetMap',
    }).addTo(homeMap);
    homeMap.attributionControl.setPrefix(false); // retire le lien « Leaflet »
  } else {
    homeMap.setView(center, 15);
  }
  if (homeMarker) homeMap.removeLayer(homeMarker);
  homeMarker = L.marker(center).addTo(homeMap);
  // Le panneau a pu être masqué/redimensionné : Leaflet doit recalculer.
  setTimeout(() => homeMap && homeMap.invalidateSize(), 0);
}

function updateMap(date) {
  const ev = eventByDate(date);
  const embed = document.getElementById('map-embed');
  const info = document.getElementById('map-info');
  if (!embed || !info) return;
  if (!ev) {
    destroyLocationMap();
    info.innerHTML = `<p class="muted">${esc(t('dates.map_none'))}</p>`;
    embed.innerHTML = '';
    return;
  }
  // La carte est centrée sur les coordonnées du lieu enregistrées en base.
  const coords = parseCoords(ev.location_coords);
  if (coords) {
    renderLocationMap(embed, coords);
  } else {
    destroyLocationMap();
    embed.innerHTML = `<div class="empty" style="padding:2rem">${esc(
      t('dates.coords_missing')
    )}</div>`;
  }
  const time = ev.start_time ? `${ev.start_time}${ev.end_time ? '–' + ev.end_time : ''}` : '';
  // Le lien Google Maps est dérivé des coordonnées (plus saisi).
  const gmaps = coords
    ? `<a href="${googleMapsUrl(coords)}" target="_blank" rel="noopener"><img class="map-icon" src="/assets/maps.webp" title="Google Maps" /></a>`
    : '';
  info.innerHTML = `
    <h4>${esc(ev.title)}</h4>
    ${gmaps}
    <p style="margin:.2rem 0"><span class="badge" style="background:${typeColor(
      ev.type
    )};color:#fff">${esc(typeLabel(ev.type))}</span></p>
    <p style="margin:.3rem 0" class="muted">📅 ${esc(formatDate(ev.date))}${
    time ? ' · 🕐 ' + esc(time) : ''
  }</p>
    ${
      ev.location_name
        ? `<p style="margin:.3rem 0">📍 <strong>${esc(ev.location_name)}</strong>${
            ev.location_address
              ? '<br><span class="muted" style="font-size:.85rem">' +
                esc(ev.location_address) +
                '</span>'
              : ''
          }</p>`
        : ''
    }
    <button class="btn btn-primary btn-sm" style="margin-top:.5rem" data-open-event="${
      ev.id
    }">${esc(t('event.see_games'))}</button>`;
}

// --- Modale soirée --------------------------------------------------------
function cacheGames(list) {
  list.forEach((g) => (GAMES_BY_ID[g.id] = g));
}

function gamePreviewHtml(g) {
  cacheGames([g]);
  return `<div class="preview-game" data-game="${g.id}">${gameThumb(g)}<div class="name">${esc(
    g.title
  )}</div></div>`;
}

async function openEvent(id) {
  openModal('event-modal');
  document.getElementById('em-title').textContent = t('event.loading');
  document.getElementById('em-body').innerHTML = '<div class="spinner"></div>';
  try {
    const e = await API.get('/api/events/' + id);
    document.getElementById('em-title').textContent = e.title;
    const time = e.start_time
      ? `${e.start_time}${e.end_time ? ' – ' + e.end_time : ''}`
      : t('event.time_tbd');
    const wa = e.whatsapp_url || (typeSignup(e.type) ? SETTINGS.whatsapp_main : '');
    const coords = parseCoords(e.location_coords);
    const gamesHtml = e.games.length
      ? `<div class="grid grid-4" style="gap:.8rem;margin-top:.6rem">${e.games
          .map(gamePreviewHtml)
          .join('')}</div>`
      : `<p class="muted">${esc(
          t(isUpcoming(e.date) ? 'event.games_soon' : 'event.games_none_past')
        )}</p>`;
    const body = document.getElementById('em-body');
    body.innerHTML = `
      <span class="badge" style="background:${typeColor(e.type)};color:#fff">${esc(
      t('event.type_inscription', { label: typeLabel(e.type), sub: typeSub(e.type) })
    )}</span>
      ${
        e.location_name && coords
          ? `<a href="${googleMapsUrl(
              coords
            )}" target="_blank" rel="noopener"><img class="map-icon" src="/assets/maps.webp" title="Google Maps" /></a>`
          : ''
      }
      <p style="margin-top:1rem"><strong>📅 ${esc(formatDate(e.date))}</strong><br>🕐 ${esc(
      time
    )}</p>
      ${
        e.location_name
          ? `<p>📍 <strong>${esc(e.location_name)}</strong>${
              e.location_address ? ' — ' + esc(e.location_address) : ''
            }</p>`
          : ''
      }
      ${e.description ? `<p>${esc(e.description)}</p>` : ''}
      ${
        typeSignup(e.type) && wa
          ? `<a class="btn btn-olive" href="${esc(
              wa
            )}" target="_blank" rel="noopener" style="margin:.5rem 0">${esc(
              t('event.register_wa')
            )}</a>`
          : ''
      }
      <h4 class="font-display" style="margin:1.4rem 0 .3rem">${esc(
        t('event.available', { count: e.games.length })
      )}</h4>
      ${gamesHtml}`;
    wireThumbFallbacks(body);
  } catch (err) {
    document.getElementById('em-body').innerHTML = `<div class="empty">${esc(
      t('event.load_error', { error: err.message })
    )}</div>`;
  }
}

// --- Aperçu de la ludothèque ---------------------------------------------
async function loadGamesPreview() {
  try {
    const [games, count] = await Promise.all([
      API.get('/api/games?sort=rating'),
      API.get('/api/games/count'),
    ]);
    GAMES_COUNT = count.count;
    renderGamesPreviewSub();
    const preview = document.getElementById('games-preview');
    preview.innerHTML =
      games.slice(0, 12).map(gamePreviewHtml).join('') ||
      `<div class="empty">${esc(t('gamesPreview.none'))}</div>`;
    wireThumbFallbacks(preview);
  } catch (e) {
    document.getElementById('games-preview').innerHTML = `<div class="empty">${esc(
      t('gamesPreview.error', { error: e.message })
    )}</div>`;
  }
}

function renderGamesPreviewSub() {
  const sub = document.getElementById('games-sub');
  if (!sub) return;
  sub.textContent =
    GAMES_COUNT == null
      ? t('gamesPreview.sub_default')
      : t('gamesPreview.sub_count', { count: GAMES_COUNT });
}

// --- Lieux + WhatsApp + FAQ ----------------------------------------------
async function loadInfos() {
  try {
    LOCS = await API.get('/api/locations');
  } catch {
    LOCS = [];
  }
  renderInfos();
}

function renderInfos() {
  const locEl = document.getElementById('locations-list');
  if (locEl)
    locEl.innerHTML = LOCS.length
      ? LOCS.map((l) => {
          const coords = parseCoords(l.coords);
          const link = coords
            ? `<br><a href="${googleMapsUrl(
                coords
              )}" target="_blank" rel="noopener" style="font-size:.85rem">${esc(
                t('infos.location_map_link')
              )}</a>`
            : '';
          return `<div style="margin-bottom:.8rem">
              <strong>${esc(l.name)}</strong>${
            l.address ? `<br><span class="muted" style="font-size:.85rem">${esc(l.address)}</span>` : ''
          }${link}
            </div>`;
        }).join('')
      : `<p class="muted">${esc(t('infos.locations_soon'))}</p>`;

  const wa = document.getElementById('whatsapp-actions');
  if (wa) {
    const parts = [];
    if (SETTINGS.whatsapp_main)
      parts.push(
        `<a class="btn btn-olive btn-sm" href="${esc(
          SETTINGS.whatsapp_main
        )}" target="_blank" rel="noopener">${esc(t('infos.wa_main'))}</a>`
      );
    if (SETTINGS.whatsapp_mjc)
      parts.push(
        `<a class="btn btn-ghost btn-sm" href="${esc(
          SETTINGS.whatsapp_mjc
        )}" target="_blank" rel="noopener">${esc(t('infos.wa_mjc'))}</a>`
      );
    wa.innerHTML =
      parts.join('') ||
      `<span class="muted" style="font-size:.85rem">${esc(t('infos.wa_todo'))}</span>`;
  }

  const faqEl = document.getElementById('faq');
  if (faqEl) {
    const faq = tRaw('faq') || [];
    faqEl.innerHTML = faq
      .map(
        (item, i) => `
      <div class="card card-pad faq-item" data-faq="${i}">
        <div class="faq-q">${esc(item.q)}<span id="faq-ic-${i}" style="color:var(--terracotta);font-size:1.4rem">+</span></div>
        <div class="faq-a" id="faq-a-${i}">${esc(item.a)}</div>
      </div>`
      )
      .join('');
  }
}

function toggleFaq(i) {
  const a = document.getElementById('faq-a-' + i);
  const ic = document.getElementById('faq-ic-' + i);
  if (!a || !ic) return;
  const open = a.classList.contains('open');
  document.querySelectorAll('.faq-a').forEach((e) => e.classList.remove('open'));
  document.querySelectorAll('[id^=faq-ic-]').forEach((e) => (e.textContent = '+'));
  if (!open) {
    a.classList.add('open');
    ic.textContent = '−';
  }
}

function revealObserve() {
  const obs = new IntersectionObserver(
    (entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) {
          e.target.classList.add('visible');
          obs.unobserve(e.target);
        }
      });
    },
    { threshold: 0.12 }
  );
  document.querySelectorAll('.fade-in:not(.visible)').forEach((el) => obs.observe(el));
}

// --- Délégation d'événements (aucun handler inline dans le HTML) ----------
function wireGlobalHandlers() {
  document.getElementById('navlinks')?.addEventListener('click', (e) => {
    const a = e.target.closest('a[data-goto]');
    if (a) goto(a.dataset.goto);
  });
  document.querySelectorAll('[data-goto]').forEach((el) => {
    if (el.tagName === 'BUTTON') el.addEventListener('click', () => goto(el.dataset.goto));
  });
  document.querySelector('.nav-burger')?.addEventListener('click', () => {
    document.getElementById('navlinks')?.classList.toggle('open');
  });
  document.querySelectorAll('.theme-toggle').forEach((b) => b.addEventListener('click', toggleTheme));
  document.querySelectorAll('[data-close-modal]').forEach((b) =>
    b.addEventListener('click', () => closeModal(b.dataset.closeModal))
  );

  // Délégation globale pour les éléments générés dynamiquement.
  document.body.addEventListener('click', (e) => {
    const openEv = e.target.closest('[data-open-event]');
    if (openEv) return openEvent(Number(openEv.dataset.openEvent));
    const evCard = e.target.closest('[data-event]');
    if (evCard) {
      const ev = ALL_EVENTS.find((x) => x.id === Number(evCard.dataset.event));
      if (ev) focusEventInCalendar(ev);
      return;
    }
    const calDay = e.target.closest('.cal-day[data-date]');
    if (calDay) return selectDate(calDay.dataset.date);
    const gameEl = e.target.closest('[data-game]');
    if (gameEl) return openGameModal(GAMES_BY_ID[Number(gameEl.dataset.game)]);
    const faq = e.target.closest('[data-faq]');
    if (faq) return toggleFaq(Number(faq.dataset.faq));
    const copyIcs = e.target.closest('[data-copy-ics]');
    if (copyIcs) {
      const url = `${location.origin}/events.ics`;
      const done = () => toast(t('infos.calendar_copied'));
      if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(url).then(done, () => window.prompt(url, url));
      } else {
        window.prompt(url, url); // repli navigateurs anciens
      }
      return;
    }
  });

  document.getElementById('cal-prev')?.addEventListener('click', calPrev);
  document.getElementById('cal-next')?.addEventListener('click', calNext);
}

// Rafraîchit tout le contenu dynamique lors d'un changement de langue.
function onLanguageChanged() {
  renderEvents();
  renderCalendar();
  updateMap(selectedDate);
  renderGamesPreviewSub();
  renderInfos();
}

document.addEventListener('DOMContentLoaded', async () => {
  initI18n();
  applyI18n(document);
  mountLangSwitchers();
  initTheme();
  wireGlobalHandlers();
  onLangChange(onLanguageChanged);
  try {
    const [settings, types] = await Promise.all([
      API.get('/api/public-settings'),
      API.get('/api/event-types'),
    ]);
    SETTINGS = settings;
    setEventTypes(types);
  } catch {}
  loadEvents();
  loadGamesPreview();
  loadInfos();
  revealObserve();
});