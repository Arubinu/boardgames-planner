// server/password.js
// Hachage de mot de passe avec Argon2id — recommandation OWASP / RFC 9106 (2026).
//
// Paramètres minimaux conseillés par l'OWASP Password Storage Cheat Sheet :
//   - type        : Argon2id (résistant GPU + side-channel)
//   - memoryCost  : 19456 KiB (19 MiB)
//   - timeCost    : 2 itérations
//   - parallelism : 1
// Cible : ~250-500 ms de calcul sur un serveur courant.
import argon2 from 'argon2';

const OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19456, // KiB → 19 MiB
  timeCost: 2,
  parallelism: 1,
};

// Un hash Argon2 encodé commence toujours par "$argon2".
export function isHashed(value) {
  return typeof value === 'string' && value.startsWith('$argon2');
}

export async function hashPassword(plain) {
  return argon2.hash(String(plain), OPTIONS);
}

export async function verifyPassword(hash, plain) {
  if (!isHashed(hash)) {
    // Sécurité défensive : si la valeur stockée n'est pas un hash valide,
    // on refuse plutôt que de comparer en clair.
    return false;
  }
  try {
    return await argon2.verify(hash, String(plain));
  } catch {
    return false;
  }
}
