/**
 * Générateur de liens de checklist LivingDex (https://livingdex.app)
 *
 * LivingDex est une app web statique (MIT, https://github.com/PimBARF/LivingDex)
 * qui encode la progression directement dans le hash de l'URL : aucun compte,
 * aucun serveur, le lien est autoporteur. Le format du hash (fonction
 * encodeCaughtState de js/storage.js de l'app, schéma v2) est :
 *   1. Bitset des captures : bit (slot-1) de l'octet (slot-1)>>3, poids
 *      faible en premier (bytes[i >> 3] |= 1 << (i & 7))
 *   2. Payload JSON : { version: 2, gameId, segments, slotCount, bits }
 *      où bits est le bitset en base64url
 *   3. Compression deflate (RFC 1950, comme CompressionStream('deflate'))
 *   4. Hash final : "#s=" + base64url sans padding du contenu compressé
 *
 * Jeu ciblé : "rby" (Red/Blue/Yellow dans la config de l'app), dex Kanto de
 * 151 slots. Les slots correspondent aux numéros du Pokédex national de la
 * génération 1, c'est-à-dire aux clés '1' à '151' du document dresseur.
 * À toute évolution du format côté app (version du schéma), il faudra
 * répercuter les constantes ici.
 */

import { deflateSync } from 'node:zlib';

const SITE_LIVINGDEX = 'https://livingdex.app';
const GAME_ID = 'rby';
const SEGMENTS = ['kanto'];
const SHARE_PAYLOAD_VERSION = 2;
const NB_PKM_GEN1 = 151;

/**
 * Construit le lien LivingDex de la checklist d'un dresseur
 * @param {Object|null} dresseur - Document MongoDB du dresseur (champs
 *        '1'-'151' à 0 ou 1), ou null pour une checklist vide
 * @returns {string} - URL complète du type
 *          https://livingdex.app/?game=rby#s=<base64url>
 */
export function construireLienDex(dresseur) {
    // 1. Bit-pack des captures (LSB-first, comme l'app)
    const octets = Buffer.alloc(Math.ceil(NB_PKM_GEN1 / 8));
    for (let slot = 1; slot <= NB_PKM_GEN1; slot++) {
        if (dresseur?.[slot] === 1) {
            const i = slot - 1;
            octets[i >> 3] |= 1 << (i & 7);
        }
    }

    // 2. Payload JSON au schéma de partage de l'app
    const payload = JSON.stringify({
        version: SHARE_PAYLOAD_VERSION,
        gameId: GAME_ID,
        segments: SEGMENTS,
        slotCount: NB_PKM_GEN1,
        bits: octets.toString('base64url')
    });

    // 3. Compression deflate puis 4. hash #s= en base64url
    const compresse = deflateSync(Buffer.from(payload, 'utf8'));
    return `${SITE_LIVINGDEX}/?game=${GAME_ID}#s=${compresse.toString('base64url')}`;
}
