// test/crud.test.mjs — couverture CRUD des contenus éditables.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, adminHeaders } from './helpers.mjs';

let srv;
before(async () => {
  srv = await startServer();
});
after(async () => {
  if (srv) await srv.stop();
});

const post = (p, body) =>
  fetch(srv.url(p), {
    method: 'POST',
    headers: adminHeaders({ 'content-type': 'application/json' }),
    body: JSON.stringify(body),
  });
const put = (p, body) =>
  fetch(srv.url(p), {
    method: 'PUT',
    headers: adminHeaders({ 'content-type': 'application/json' }),
    body: JSON.stringify(body),
  });
const del = (p) => fetch(srv.url(p), { method: 'DELETE', headers: adminHeaders() });
const getJson = async (p) => (await fetch(srv.url(p))).json();

// ---- Types d'évènement ---------------------------------------------------
test("type d'évènement : POST sans libellé → 400", async () => {
  assert.equal((await post('/api/admin/event-types', {})).status, 400);
});

test("type d'évènement : DELETE inexistant → 404", async () => {
  assert.equal((await del('/api/admin/event-types/99999999')).status, 404);
});

// ---- Évènements ----------------------------------------------------------
test('évènement : POST sans titre/date → 400', async () => {
  assert.equal((await post('/api/admin/events', { title: 'sans date' })).status, 400);
});

test('flux complet : type → lieu → évènement (jointure, contraintes, maj, suppression)', async () => {
  const label = `Type Test ${Date.now()}`;

  // Créer un type d'évènement.
  const t = await (await post('/api/admin/event-types', { label, color: '#123456', signup: 1 })).json();
  assert.ok(t.id && t.key, 'id et key générés');
  assert.equal(t.signup, 1, 'signup normalisé à 1');
  assert.ok((await getJson('/api/event-types')).some((x) => x.id === t.id));

  // Mettre à jour le type.
  const t2 = await (
    await put(`/api/admin/event-types/${t.id}`, { label, sub: 'sous-titre', color: '#abcdef', signup: 0 })
  ).json();
  assert.equal(t2.sub, 'sous-titre');
  assert.equal(t2.signup, 0);

  // Un lieu pour rattacher l'évènement.
  const loc = await (await post('/api/admin/locations', { name: `Lieu ${Date.now()}` })).json();

  // Créer un évènement de ce type, dans ce lieu.
  const created = await post('/api/admin/events', {
    title: 'Soirée test',
    date: '2099-12-31',
    type: t.key,
    location_id: loc.id,
    game_ids: [],
  });
  assert.equal(created.status, 200);
  const { id: eventId } = await created.json();
  assert.ok(eventId, 'id renvoyé');

  // Liste publique : présent, avec la jointure du lieu et le bon type.
  const row = (await getJson('/api/events')).find((e) => e.id === eventId);
  assert.ok(row, 'évènement listé');
  assert.equal(row.type, t.key);
  assert.equal(row.location_name, loc.name);

  // Détail : tableau games présent.
  const detail = await getJson(`/api/events/${eventId}`);
  assert.ok(Array.isArray(detail.games));

  // Détail d'un id inexistant → 404.
  assert.equal((await fetch(srv.url('/api/events/99999999'))).status, 404);

  // Supprimer un type encore utilisé → refusé (409).
  assert.equal((await del(`/api/admin/event-types/${t.id}`)).status, 409);

  // Mettre à jour l'évènement.
  assert.equal(
    (await put(`/api/admin/events/${eventId}`, { title: 'Soirée modifiée', date: '2099-12-31', type: t.key })).status,
    200
  );
  assert.equal((await getJson(`/api/events/${eventId}`)).title, 'Soirée modifiée');

  // Supprimer l'évènement, puis le type (désormais inutilisé) → OK.
  assert.equal((await del(`/api/admin/events/${eventId}`)).status, 200);
  assert.equal((await del(`/api/admin/event-types/${t.id}`)).status, 200);
  assert.ok(!(await getJson('/api/event-types')).some((x) => x.id === t.id));

  // Nettoyage du lieu.
  await del(`/api/admin/locations/${loc.id}`);
});

// ---- Blocs « Infos pratiques » -------------------------------------------
test("blocs d'info : CRUD complet", async () => {
  assert.equal((await post('/api/admin/info-blocks', { body: 'x' })).status, 400, 'titre requis');

  const b = await (
    await post('/api/admin/info-blocks', { icon: '🎲', title: `Bloc ${Date.now()}`, body: 'Texte' })
  ).json();
  assert.ok(b.id);
  assert.equal(b.kind, 'text', "les blocs créés sont de type 'text'");
  assert.ok((await getJson('/api/info-blocks')).some((x) => x.id === b.id));

  const u = await (
    await put(`/api/admin/info-blocks/${b.id}`, { icon: '📌', title: 'Bloc modifié', body: 'Nouveau' })
  ).json();
  assert.equal(u.title, 'Bloc modifié');

  assert.equal((await del(`/api/admin/info-blocks/${b.id}`)).status, 200);
  assert.equal((await del('/api/admin/info-blocks/99999999')).status, 404);
});

// ---- FAQ -----------------------------------------------------------------
test('FAQ : CRUD + réordonnancement', async () => {
  assert.equal((await post('/api/admin/faq', { answer: 'sans question' })).status, 400, 'question requise');

  const q1 = await (await post('/api/admin/faq', { question: `Q1 ${Date.now()}`, answer: 'A1' })).json();
  const q2 = await (await post('/api/admin/faq', { question: `Q2 ${Date.now()}`, answer: 'A2' })).json();
  assert.ok(q1.id && q2.id);

  const u = await (await put(`/api/admin/faq/${q1.id}`, { question: 'Q1 modifiée', answer: 'A1 bis' })).json();
  assert.equal(u.question, 'Q1 modifiée');

  // Réordonnancement : on inverse l'ordre courant complet et on vérifie.
  const ids = (await getJson('/api/faq')).map((f) => f.id);
  const reversed = [...ids].reverse();
  assert.equal((await put('/api/admin/faq/reorder', { ids: reversed })).status, 200);
  assert.deepEqual((await getJson('/api/faq')).map((f) => f.id), reversed);

  assert.equal((await del(`/api/admin/faq/${q1.id}`)).status, 200);
  assert.equal((await del(`/api/admin/faq/${q2.id}`)).status, 200);
});
