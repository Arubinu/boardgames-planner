// test/api.test.mjs — tests d'intégration des chemins critiques.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, adminHeaders, PWD } from './helpers.mjs';

let srv;
before(async () => {
  srv = await startServer();
});
after(async () => {
  if (srv) await srv.stop();
});

const json = (body) => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

test('healthz répond 200', async () => {
  const r = await fetch(srv.url('/healthz'));
  assert.equal(r.status, 200);
});

test('public-settings renvoie du JSON', async () => {
  const r = await fetch(srv.url('/api/public-settings'));
  assert.equal(r.status, 200);
  assert.equal(typeof (await r.json()), 'object');
});

test("la page d'accueil est servie en HTML", async () => {
  const r = await fetch(srv.url('/'));
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type') || '', /text\/html/);
});

test('404 : JSON pour /api, HTML pour une page', async () => {
  const api = await fetch(srv.url('/api/inexistant'));
  assert.equal(api.status, 404);
  assert.equal((await api.json()).error, 'Ressource introuvable');

  const page = await fetch(srv.url('/page-inexistante'));
  assert.equal(page.status, 404);
  assert.match(page.headers.get('content-type') || '', /text\/html/);
});

test('corps JSON invalide → 400', async () => {
  const r = await fetch(srv.url('/api/admin/login'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: 'pas-du-json',
  });
  assert.equal(r.status, 400);
});

test('auth admin : 401 sans / mauvais mdp, 200 avec le bon', async () => {
  assert.equal((await fetch(srv.url('/api/admin/settings'))).status, 401);

  const bad = await fetch(srv.url('/api/admin/login'), json({ password: 'mauvais' }));
  assert.equal(bad.status, 401);

  const ok = await fetch(srv.url('/api/admin/login'), json({ password: PWD }));
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).ok, true);

  const settings = await fetch(srv.url('/api/admin/settings'), { headers: adminHeaders() });
  assert.equal(settings.status, 200);
});

test("?pwd= dans l'URL n'authentifie plus", async () => {
  const r = await fetch(srv.url(`/api/admin/settings?pwd=${PWD}`));
  assert.equal(r.status, 401);
});

test('réglage meta_keywords : enregistré puis injecté dans le <head>', async () => {
  const kw = `jeux, ludotheque, test-${Date.now()}`;
  const put = await fetch(srv.url('/api/admin/settings'), {
    method: 'PUT',
    headers: adminHeaders({ 'content-type': 'application/json' }),
    body: JSON.stringify({ meta_keywords: kw }),
  });
  assert.equal(put.status, 200);

  const home = await (await fetch(srv.url('/'))).text();
  assert.ok(
    home.includes(`<meta name="keywords" content="${kw}"`),
    'la balise keywords doit être injectée dans la page'
  );
});

test('CRUD lieu : créer → lister → archiver', async () => {
  const name = `Salle Test ${Date.now()}`;
  const created = await fetch(srv.url('/api/admin/locations'), {
    method: 'POST',
    headers: adminHeaders({ 'content-type': 'application/json' }),
    body: JSON.stringify({ name }),
  });
  assert.equal(created.status, 200);
  const loc = await created.json();
  assert.ok(loc.id, 'un id doit être renvoyé');

  const listed = await (await fetch(srv.url('/api/locations'))).json();
  assert.ok(listed.some((l) => l.id === loc.id), 'le lieu doit apparaître');

  const del = await fetch(srv.url(`/api/admin/locations/${loc.id}`), {
    method: 'DELETE',
    headers: adminHeaders(),
  });
  assert.equal(del.status, 200);

  const after = await (await fetch(srv.url('/api/locations'))).json();
  assert.ok(!after.some((l) => l.id === loc.id), 'le lieu archivé ne doit plus apparaître');
});

test("export DB : structure correcte et mot de passe admin exclu", async () => {
  const r = await fetch(srv.url('/api/admin/db-export'), { headers: adminHeaders() });
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.type, 'boardgames-planner-export');
  assert.equal(j.version, 1);
  assert.ok(j.data && Array.isArray(j.data.locations));
  const settings = j.data.settings || [];
  assert.ok(
    !settings.some((s) => s.key === 'admin_password'),
    'admin_password ne doit jamais être exporté'
  );
});

test('aller-retour export → import (catégorie lieux)', async () => {
  const exported = await (await fetch(srv.url('/api/admin/db-export'), { headers: adminHeaders() })).json();
  const before = (await (await fetch(srv.url('/api/locations'))).json()).length;

  const fd = new FormData();
  fd.set('categories', JSON.stringify(['locations']));
  fd.set('backup', new Blob([JSON.stringify(exported)], { type: 'application/json' }), 'backup.json');
  const imp = await fetch(srv.url('/api/admin/db-import'), {
    method: 'POST',
    headers: adminHeaders(),
    body: fd,
  });
  assert.equal(imp.status, 200);

  const after = (await (await fetch(srv.url('/api/locations'))).json()).length;
  assert.equal(after, before, 'le nombre de lieux doit être préservé');
});

test('sitemap.xml et robots.txt (URLs déduites de la requête)', async () => {
  const sm = await fetch(srv.url('/sitemap.xml'), {
    headers: { 'x-forwarded-proto': 'https', 'x-forwarded-host': 'example.test' },
  });
  assert.equal(sm.status, 200);
  const xml = await sm.text();
  assert.match(xml, /<urlset/);
  assert.match(xml, /https:\/\/example\.test\//);

  const rb = await fetch(srv.url('/robots.txt'));
  assert.equal(rb.status, 200);
  assert.match(await rb.text(), /Sitemap:/);
});

test('rate-limit : 429 après ADMIN_RATE_LIMIT_MAX échecs', async () => {
  const s = await startServer({
    ADMIN_RATE_LIMIT_MAX: '3',
    ADMIN_RATE_LIMIT_WINDOW: '15',
    LOGIN_RETRY_DELAY: '0',
  });
  try {
    const codes = [];
    for (let i = 0; i < 5; i++) {
      const r = await fetch(s.url('/api/admin/login'), json({ password: 'mauvais' }));
      codes.push(r.status);
    }
    assert.equal(codes[0], 401, `premier essai 401 (obtenu ${codes.join(',')})`);
    assert.ok(codes.includes(429), `doit finir par 429 (obtenu ${codes.join(',')})`);
  } finally {
    await s.stop();
  }
});

test('IndexNow : sert /<clé>.txt si INDEXNOW_KEY est défini', async () => {
  const key = `testkey${Date.now()}`;
  const s = await startServer({ INDEXNOW_KEY: key });
  try {
    const r = await fetch(s.url(`/${key}.txt`));
    assert.equal(r.status, 200);
    assert.equal((await r.text()).trim(), key);
    // une autre URL .txt ne doit pas être interceptée
    assert.equal((await fetch(s.url('/autre.txt'))).status, 404);
  } finally {
    await s.stop();
  }
});
