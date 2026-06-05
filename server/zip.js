// server/zip.js
// Générateur d'archive ZIP minimaliste, sans dépendance externe.
//
// On utilise la méthode « stored » (aucune compression) : les documents
// d'adhésion (PDF, JPG, PNG) sont déjà compressés, donc une recompression
// n'apporterait rien tout en ajoutant une dépendance (archiver, jszip…).
// Le format produit est conforme à la spec PKZIP (APPNOTE) et lisible par
// tous les outils courants (unzip, Explorateur Windows, macOS, 7-Zip).

// Table CRC-32 (polynôme standard 0xEDB88320), calculée une seule fois.
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// Garantit des noms d'entrée uniques dans l'archive (sinon certains outils
// n'extraient que le premier fichier). En cas de doublon : « nom (2).ext ».
function uniqueNames(entries) {
  const seen = new Map();
  return entries.map((e) => {
    let name = String(e.name || 'fichier').replace(/[\\/]+/g, '_');
    if (seen.has(name)) {
      const n = seen.get(name) + 1;
      seen.set(name, n);
      const dot = name.lastIndexOf('.');
      name =
        dot > 0 ? `${name.slice(0, dot)} (${n})${name.slice(dot)}` : `${name} (${n})`;
    } else {
      seen.set(name, 1);
    }
    return { name, data: e.data };
  });
}

// entries : [{ name: string, data: Buffer }]. Renvoie un Buffer ZIP complet.
export function zipSync(rawEntries) {
  const entries = uniqueNames(rawEntries);
  const fileParts = [];
  const central = [];
  let offset = 0;

  for (const entry of entries) {
    const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data);
    const nameBuf = Buffer.from(entry.name, 'utf8');
    const crc = crc32(data);
    const size = data.length;

    // En-tête local (30 octets + nom).
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); // signature
    local.writeUInt16LE(20, 4); // version nécessaire
    local.writeUInt16LE(0x0800, 6); // drapeaux : nom encodé en UTF-8 (bit 11)
    local.writeUInt16LE(0, 8); // méthode : 0 = stored
    local.writeUInt16LE(0, 10); // heure (non significative)
    local.writeUInt16LE(0, 12); // date (non significative)
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(size, 18); // taille compressée = taille (stored)
    local.writeUInt32LE(size, 22); // taille décompressée
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28); // longueur du champ « extra »
    fileParts.push(local, nameBuf, data);

    // Entrée du répertoire central (46 octets + nom).
    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0); // signature
    dir.writeUInt16LE(20, 4); // version créateur
    dir.writeUInt16LE(20, 6); // version nécessaire
    dir.writeUInt16LE(0x0800, 8); // drapeaux (UTF-8)
    dir.writeUInt16LE(0, 10); // méthode : stored
    dir.writeUInt16LE(0, 12); // heure
    dir.writeUInt16LE(0, 14); // date
    dir.writeUInt32LE(crc, 16);
    dir.writeUInt32LE(size, 20);
    dir.writeUInt32LE(size, 24);
    dir.writeUInt16LE(nameBuf.length, 28);
    dir.writeUInt16LE(0, 30); // extra
    dir.writeUInt16LE(0, 32); // commentaire
    dir.writeUInt16LE(0, 34); // n° de disque
    dir.writeUInt16LE(0, 36); // attributs internes
    dir.writeUInt32LE(0, 38); // attributs externes
    dir.writeUInt32LE(offset, 42); // décalage de l'en-tête local
    central.push(Buffer.concat([dir, nameBuf]));

    offset += local.length + nameBuf.length + data.length;
  }

  const centralBuf = Buffer.concat(central);
  const centralOffset = offset;

  // Fin du répertoire central (EOCD, 22 octets).
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4); // n° de disque
  eocd.writeUInt16LE(0, 6); // disque du répertoire central
  eocd.writeUInt16LE(entries.length, 8); // entrées sur ce disque
  eocd.writeUInt16LE(entries.length, 10); // entrées totales
  eocd.writeUInt32LE(centralBuf.length, 12); // taille du répertoire central
  eocd.writeUInt32LE(centralOffset, 16); // décalage du répertoire central
  eocd.writeUInt16LE(0, 20); // longueur du commentaire

  return Buffer.concat([...fileParts, centralBuf, eocd]);
}
