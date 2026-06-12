// test/games.test.mjs — tests d'intégration des jeux hors collection, de l'upload
// et du ZIP d'images, de la restauration de sauvegarde par source, et de la
// normalisation des tirets. Chaque test démarre un serveur frais (base isolée)
// car plusieurs scénarios sont destructifs (imports, restaurations).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import AdmZip from 'adm-zip';
import { startServer, adminHeaders } from './helpers.mjs';

// Vrai PNG 1×1 (l'upload le reconvertit en WebP via sharp).
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADElEQVQImWM4EaABAAMkAUFIBLJyAAAAAElFTkSuQmCC',
  'base64'
);

// Petits utilitaires montés sur un serveur donné.
function api(s) {
  const U = (p) => s.url(p);
  const jhdr = adminHeaders({ 'content-type': 'application/json' });
  return {
    games: async () => (await fetch(U('/api/games'))).json(),
    createManual: (body) =>
      fetch(U('/api/admin/games'), { method: 'POST', headers: jhdr, body: JSON.stringify(body) }).then((r) => r.json()),
    updateGame: (id, body) =>
      fetch(U('/api/admin/games/' + id), { method: 'PUT', headers: jhdr, body: JSON.stringify(body) }).then((r) => r.json()),
    importMyludo: (records, mode = 'replace') => {
      const fd = new FormData();
      fd.set('file', new Blob([JSON.stringify(records)], { type: 'application/json' }), 'collection.json');
      return fetch(U(`/api/admin/import?mode=${mode}`), { method: 'POST', headers: adminHeaders(), body: fd });
    },
    uploadImage: (bytes, type, name) => {
      const fd = new FormData();
      fd.set('image', new Blob([bytes], { type }), name);
      return fetch(U('/api/admin/upload-image'), { method: 'POST', headers: adminHeaders(), body: fd });
    },
    U,
  };
}

test('jeu hors collection : id négatif, source=manual, listé, et survit à un import replace', async () => {
  const s = await startServer();
  try {
    const a = api(s);
    const man = await a.createManual({ title: 'Jeu Maison', players: '2 — 5' });
    assert.ok(man.id < 0, 'id négatif');
    assert.equal(man.source, 'manual');

    let all = await a.games();
    assert.ok(all.some((g) => g.id === man.id), 'listé dans /api/games');

    // Import MyLudo en mode replace (le plus destructif).
    const imp = await a.importMyludo([{ ID: '12345', Titre: 'Jeu MyLudo' }], 'replace');
    assert.equal(imp.status, 200);

    all = await a.games();
    assert.ok(all.some((g) => g.id === 12345 && g.source === 'myludo'), 'jeu MyLudo importé');
    assert.ok(all.some((g) => g.id === man.id && g.source === 'manual'), 'le jeu manuel SURVIT au replace');
  } finally {
    await s.stop();
  }
});

test('édition complète des jeux manuels ; jeux MyLudo restreints à image/propriétaire', async () => {
  const s = await startServer();
  try {
    const a = api(s);
    const man = await a.createManual({ title: 'Maison', players: '2 — 4', categories: 'Famille' });
    await a.importMyludo([{ ID: '777', Titre: 'MyLudo' }], 'replace');

    const upMan = await a.updateGame(man.id, { title: 'Maison v2', players: '1 — 4', categories: 'Stratégie' });
    assert.equal(upMan.title, 'Maison v2');
    assert.equal(upMan.players, '1 — 4');
    assert.equal(upMan.categories, 'Stratégie');

    // Sur un jeu MyLudo : le titre n'est pas modifiable, seuls image/owner le sont.
    const upMy = await a.updateGame(777, { title: 'PIRATÉ', owner: 'Alice', image_url: 'https://x.test/c.jpg' });
    assert.equal(upMy.title, 'MyLudo', 'titre MyLudo préservé');
    assert.equal(upMy.owner, 'Alice');
    assert.equal(upMy.image_url, 'https://x.test/c.jpg');
  } finally {
    await s.stop();
  }
});

test('normalisation des tirets en cadratin (joueurs/durée), idempotente', async () => {
  const s = await startServer();
  try {
    const a = api(s);
    const g1 = await a.createManual({ title: 'A', players: '2-4', duration: '30 - 60' });
    assert.equal(g1.players, '2 — 4');
    assert.equal(g1.duration, '30 — 60');

    const g2 = await a.createManual({ title: 'B', players: '1+', duration: '45' });
    assert.equal(g2.players, '1+', 'sans tiret : inchangé');
    assert.equal(g2.duration, '45');

    const g3 = await a.createManual({ title: 'C', players: '2–5' }); // demi-cadratin
    assert.equal(g3.players, '2 — 5');

    const u1 = await a.updateGame(g3.id, { players: '3-6' });
    assert.equal(u1.players, '3 — 6');
    const u2 = await a.updateGame(g3.id, { players: '3 — 6' });
    assert.equal(u2.players, '3 — 6', 'idempotent');
  } finally {
    await s.stop();
  }
});

test("upload d'image : URL renvoyée et servie ; type non-image refusé", async () => {
  const s = await startServer();
  try {
    const a = api(s);
    const up = await a.uploadImage(PNG, 'image/png', 'a.png');
    assert.equal(up.status, 200);
    const { url } = await up.json();
    assert.match(url, /^\/uploads\/games\/.+\.webp$/, 'converti en WebP');
    assert.equal((await fetch(a.U(url))).status, 200, 'image servie');

    const bad = await a.uploadImage(Buffer.from('coucou'), 'text/plain', 'a.txt');
    assert.equal(bad.status, 400, 'type non-image refusé');
  } finally {
    await s.stop();
  }
});

test('export/import ZIP des images (daté, anti-traversal, non-images ignorés)', async () => {
  const s = await startServer();
  try {
    const a = api(s);
    const { url } = await (await a.uploadImage(PNG, 'image/png', 'a.png')).json();
    const fileA = url.split('/').pop();

    // Export : zip daté contenant l'image téléversée.
    const exp = await fetch(a.U('/api/admin/images-export'), { headers: adminHeaders() });
    assert.equal(exp.headers.get('content-type'), 'application/zip');
    assert.match(exp.headers.get('content-disposition') || '', /filename="boardgames-images-\d{4}-\d{2}-\d{2}\.zip"/);
    const names = new AdmZip(Buffer.from(await exp.arrayBuffer())).getEntries().map((e) => e.entryName);
    assert.ok(names.includes(fileA), 'le ZIP contient l’image');

    // Import : 1 image valide + 1 entrée traversante (assainie) + 1 non-image (ignorée).
    const zip = new AdmZip();
    zip.addFile('restore-test.png', PNG);
    zip.addFile('evil/../hack.png', PNG);
    zip.addFile('ignore.txt', Buffer.from('non'));
    const fd = new FormData();
    fd.set('images', new Blob([zip.toBuffer()], { type: 'application/zip' }), 'images.zip');
    const imp = await (await fetch(a.U('/api/admin/images-import'), { method: 'POST', headers: adminHeaders(), body: fd })).json();
    assert.equal(imp.imported, 2, 'le .txt est ignoré');
    assert.equal((await fetch(a.U('/uploads/games/restore-test.png'))).status, 200);
    assert.equal((await fetch(a.U('/uploads/games/hack.png'))).status, 200, 'entrée traversante assainie');
  } finally {
    await s.stop();
  }
});

test('image_url préservée lors d’un ré-import (MyLudo et manuel)', async () => {
  const s = await startServer();
  try {
    const a = api(s);
    await a.importMyludo([{ ID: '12345', Titre: 'MyLudo' }], 'replace');
    await a.updateGame(12345, { image_url: 'https://x.test/cover.jpg', owner: 'Bob' });
    const man = await a.createManual({ title: 'Maison', image_url: '/uploads/games/maison.png' });

    await a.importMyludo([{ ID: '12345', Titre: 'MyLudo' }], 'replace');

    const all = await a.games();
    assert.equal(all.find((g) => g.id === 12345).image_url, 'https://x.test/cover.jpg', 'image MyLudo conservée');
    assert.equal(all.find((g) => g.id === man.id).image_url, '/uploads/games/maison.png', 'image manuelle conservée');
  } finally {
    await s.stop();
  }
});

test('restauration de sauvegarde par source : MyLudo et hors collection indépendants', async () => {
  const s = await startServer();
  try {
    const a = api(s);
    const titles = async () => {
      const all = await a.games();
      return {
        manual: all.filter((g) => g.source === 'manual').map((g) => g.title).sort(),
        myludo: all.filter((g) => g.source !== 'manual').map((g) => g.title).sort(),
      };
    };
    const restore = (backup, cats) => {
      const fd = new FormData();
      fd.set('backup', new Blob([JSON.stringify(backup)], { type: 'application/json' }), 'backup.json');
      fd.set('categories', JSON.stringify(cats));
      return fetch(a.U('/api/admin/db-import'), { method: 'POST', headers: adminHeaders(), body: fd });
    };

    // État capturé dans la sauvegarde : M1 + Y1.
    await a.createManual({ title: 'M1' });
    await a.importMyludo([{ ID: '12345', Titre: 'Y1' }], 'replace');
    const B = await (await fetch(a.U('/api/admin/db-export'), { headers: adminHeaders() })).json();
    assert.equal((B.data.games || []).length, 2);

    // On ajoute M2 et Y2 APRÈS la sauvegarde.
    await a.createManual({ title: 'M2' });
    await a.importMyludo([{ ID: '999', Titre: 'Y2' }], 'merge');
    assert.deepEqual(await titles(), { manual: ['M1', 'M2'], myludo: ['Y1', 'Y2'] });

    // Restaurer SEULEMENT les jeux MyLudo : Y revient à {Y1}, les manuels intacts.
    assert.equal((await restore(B, ['games_myludo'])).status, 200);
    assert.deepEqual(await titles(), { manual: ['M1', 'M2'], myludo: ['Y1'] });

    // Restaurer SEULEMENT les hors-collection : M revient à {M1}, les MyLudo intacts.
    assert.equal((await restore(B, ['games_manual'])).status, 200);
    assert.deepEqual(await titles(), { manual: ['M1'], myludo: ['Y1'] });
  } finally {
    await s.stop();
  }
});
