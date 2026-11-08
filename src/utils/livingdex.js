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
 * Jeu ciblé : "gsc" (Gold/Silver/Crystal dans la config de l'app), dex Johto
 * de 251 slots (game.numberOfPokemon : générations 1+2). Les slots
 * correspondent aux numéros du Pokédex national, c'est-à-dire aux clés
 * '1' à 'numberOfPokemon' du document dresseur.
 * À toute évolution du format côté app (version du schéma), il faudra
 * répercuter les constantes ici.
 */

import { deflateSync } from 'node:zlib';

import { getConfig } from './configLoader.js';
import { decodeDexBits, encodeDexBits, bitsDepuisLegacy } from './dexBits.js';

const SITE_LIVINGDEX = 'https://livingdex.app';
const GAME_ID = 'gsc';
const SEGMENTS = ['johto'];
const SHARE_PAYLOAD_VERSION = 2;
const NB_PKM_DEX = getConfig().game.numberOfPokemon;

/**
 * Construit le lien LivingDex de la checklist d'un dresseur
 * @param {Object|null} dresseur - Document MongoDB du dresseur (champ dexBits
 *        base64url, ou anciens champs '1'..numberOfPokemon en repli), ou null
 * @returns {string} - URL complète du type
 *          https://livingdex.app/?game=gsc#s=<base64url>
 */
export function construireLienDex(dresseur) {
    // 1. Bitset des captures (LSB-first, comme l'app) : champ dexBits si
    //    présent (même encodage), sinon repli depuis les anciens champs numériques
    const bitsB64 = dresseur?.dexBits !== undefined && dresseur?.dexBits !== null
        ? encodeDexBits(decodeDexBits(dresseur.dexBits, NB_PKM_DEX))
        : encodeDexBits(bitsDepuisLegacy(dresseur, NB_PKM_DEX));

    // 2. Payload JSON au schéma de partage de l'app
    const payload = JSON.stringify({
        version: SHARE_PAYLOAD_VERSION,
        gameId: GAME_ID,
        segments: SEGMENTS,
        slotCount: NB_PKM_DEX,
        bits: bitsB64
    });

    // 3. Compression deflate puis 4. hash #s= en base64url
    const compresse = deflateSync(Buffer.from(payload, 'utf8'));
    return `${SITE_LIVINGDEX}/?game=${GAME_ID}#s=${compresse.toString('base64url')}`;
}
