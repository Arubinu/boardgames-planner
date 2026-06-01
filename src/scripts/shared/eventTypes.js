// scripts/shared/eventTypes.js
// Registre runtime des « types de soirées », alimenté depuis l'API
// (table event_types, gérée dans l'administration). Plus aucun type, libellé
// ou couleur écrit en dur : tout vient de la base. Chaque page appelle
// setEventTypes(...) au démarrage, AVANT le moindre rendu d'événement.

let REGISTRY = {}; // key -> { key, label, sub, color, signup }
let ORDER = []; // clés dans l'ordre d'affichage (sort_order)

export function setEventTypes(list) {
  REGISTRY = {};
  ORDER = [];
  for (const it of list || []) {
    REGISTRY[it.key] = {
      key: it.key,
      label: it.label || '',
      sub: it.sub || '',
      color: it.color || '#888888',
      signup: !!it.signup,
    };
    ORDER.push(it.key);
  }
}

export function eventTypeList() {
  return ORDER.map((k) => REGISTRY[k]);
}
export function eventTypeOrder() {
  return ORDER.slice();
}
export function defaultType() {
  return ORDER[0] || '';
}

// Normalise un type inconnu (ou supprimé) vers le premier type disponible.
export function typeKey(type) {
  return REGISTRY[type] ? type : defaultType();
}
function meta(type) {
  return (
    REGISTRY[typeKey(type)] || { label: '', sub: '', color: '#888888', signup: false }
  );
}

export function typeLabel(type) {
  return meta(type).label;
}
export function typeSub(type) {
  return meta(type).sub;
}
export function typeColor(type) {
  return meta(type).color;
}
export function typeSignup(type) {
  return meta(type).signup;
}
// Libellé court (plus de variante distincte : on réutilise le libellé).
export function typeShort(type) {
  return meta(type).label;
}
// Texte d'option de menu déroulant : « Libellé (mention) » si une mention existe.
export function typeOption(type) {
  const m = meta(type);
  return m.sub ? `${m.label} (${m.sub})` : m.label;
}
