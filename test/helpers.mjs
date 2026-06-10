// test/helpers.mjs — démarre le serveur sur une base temporaire + port aléatoire,
// attend qu'il réponde, et fournit de quoi l'arrêter. Tests d'intégration en
// boîte noire (on tape sur le vrai serveur via fetch).
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Mot de passe admin de test : c'est la valeur seedée par défaut (server/db.js).
export const PWD = process.env.TEST_ADMIN_PASSWORD || 'admin';
export const adminHeaders = (extra = {}) => ({ 'x-admin-password': PWD, ...extra });

export async function startServer(extraEnv = {}) {
  const dataDir = mkdtempSync(join(tmpdir(), 'bgp-test-'));
  const port = 20000 + Math.floor(Math.random() * 20000);
  const child = spawn(process.execPath, ['server/index.js'], {
    cwd: process.cwd(),
    env: { ...process.env, DATA_DIR: dataDir, PORT: String(port), ...extraEnv },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stdout.on('data', (d) => (log += d));
  child.stderr.on('data', (d) => (log += d));

  const base = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 15000;
  for (;;) {
    if (child.exitCode !== null) {
      throw new Error(`Le serveur s'est arrêté au démarrage :\n${log}`);
    }
    try {
      const r = await fetch(`${base}/healthz`);
      if (r.ok) break;
    } catch {
      /* pas encore prêt */
    }
    if (Date.now() > deadline) throw new Error(`Délai de démarrage dépassé :\n${log}`);
    await new Promise((r) => setTimeout(r, 150));
  }

  const stop = () =>
    new Promise((resolve) => {
      child.once('exit', () => {
        try {
          rmSync(dataDir, { recursive: true, force: true });
        } catch {
          /* ignore */
        }
        resolve();
      });
      child.kill('SIGTERM');
    });

  return { base, stop, url: (p) => base + p, get log() { return log; } };
}
