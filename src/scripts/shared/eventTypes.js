// scripts/shared/eventTypes.js
// Source unique des « types de soirées ».
//
// La structure visuelle (classes CSS de badge, de pastille de calendrier et de
// légende) est définie ici ; les libellés affichés proviennent de l'i18n
// (clés `eventType.<type>.*`). Plus aucun « Grande soirée » / « Petite soirée »
// écrit en dur dans les pages : tout passe par ces helpers.

import { t } from './i18n.js';

// Ordre d'affichage canonique (utilisé pour la légende et le formulaire admin).
export const EVENT_TYPE_ORDER = ['grande', 'petite'];

const META = {
  grande: { badge: 'badge-grande', cal: 'ev-grande', dot: 'dot-grande' },
  petite: { badge: 'badge-petite', cal: 'ev-petite', dot: 'dot-petite' },
};

export const DEFAULT_TYPE = 'petite';

// Normalise un type inconnu vers le type par défaut.
export function typeKey(type) {
  return META[type] ? type : DEFAULT_TYPE;
}
function meta(type) {
  return META[typeKey(type)];
}

export function badgeClass(type) {
  return meta(type).badge;
}
export function calClass(type) {
  return meta(type).cal;
}
export function dotClass(type) {
  return meta(type).dot;
}

// Libellés traduits.
export function typeLabel(type) {
  return t(`eventType.${typeKey(type)}.label`);
}
export function typeShort(type) {
  return t(`eventType.${typeKey(type)}.short`);
}
export function typeSub(type) {
  return t(`eventType.${typeKey(type)}.sub`);
}
export function typeOption(type) {
  return t(`eventType.${typeKey(type)}.option`);
}
