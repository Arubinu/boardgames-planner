// scripts/shared/maps.js
// Construction des URL cartographiques à partir de coordonnées « lat,lon »
// stockées en base. L'embed OpenStreetMap pointe sur un lieu fixe (les
// coordonnées enregistrées) ; le lien Google Maps est dérivé des mêmes
// coordonnées (il n'est plus saisi à la main).

// Analyse une chaîne "lat,lon" → { lat, lon } ou null si invalide.
export function parseCoords(value) {
  if (!value) return null;
  const m = String(value).split(',').map((s) => parseFloat(s.trim()));
  if (m.length !== 2 || !Number.isFinite(m[0]) || !Number.isFinite(m[1])) return null;
  const [lat, lon] = m;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  return { lat, lon };
}

// URL d'embed OpenStreetMap centrée sur le point, avec un marqueur fixe.
export function osmEmbedUrl(coords, span = 0.012) {
  const { lat, lon } = coords;
  const bbox = [lon - span, lat - span / 1.6, lon + span, lat + span / 1.6]
    .map((n) => n.toFixed(6))
    .join('%2C');
  return (
    `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}` +
    `&layer=mapnik&marker=${lat.toFixed(6)}%2C${lon.toFixed(6)}`
  );
}

// Lien Google Maps dérivé des coordonnées (ouverture dans l'app/web Maps).
export function googleMapsUrl(coords) {
  const { lat, lon } = coords;
  return `https://www.google.com/maps/search/?api=1&query=${lat},${lon}`;
}
