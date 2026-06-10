// test/i18n.test.mjs — vérifie que les dictionnaires FR et EN ont exactement
// les mêmes clés (détecte une traduction oubliée).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fr from '../src/scripts/shared/locales/fr.js';
import en from '../src/scripts/shared/locales/en.js';

function keyPaths(obj, prefix = '') {
  const out = [];
  for (const [k, v] of Object.entries(obj)) {
    const p = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) out.push(...keyPaths(v, p));
    else out.push(p);
  }
  return out.sort();
}

test('parité des clés i18n FR ↔ EN', () => {
  const f = keyPaths(fr);
  const e = keyPaths(en);
  const missingInEn = f.filter((k) => !e.includes(k));
  const missingInFr = e.filter((k) => !f.includes(k));
  assert.deepEqual(missingInEn, [], 'clés présentes en FR mais absentes en EN');
  assert.deepEqual(missingInFr, [], 'clés présentes en EN mais absentes en FR');
});
