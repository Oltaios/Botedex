/**
 * Encodage compact du Pokédex d'un dresseur : un bitset base64url.
 *
 * Principe : le bit (numPkm - 1) est stocké dans l'octet (numPkm - 1) >> 3,
 * bit de poids (numPkm - 1) & 7 (LSB first) — exactement le même encodage
 * que le champ `bits` du lien LivingDex (livingdex.js), réutilisé tel quel.
 *
 * Extensibilité : la taille du buffer est dérivée de game.numberOfPokemon
 * (jamais en dur) et le décodage complète à zéro — un ancien document reste
 * valide quand on ajoute des Pokémon (les bits manquants valent 0 = non capturé).
 *
 * Exemple d'utilisation :
 *   import { decodeDexBits, setBitDex, aCaptureDex, encodeDexBits } from './utils/dexBits.js';
 *   const bits = decodeDexBits(row.dexBits);
 *   setBitDex(bits, 25);
 *   row.dexBits = encodeDexBits(bits);
 */

import { getConfig } from './configLoader.js';

/** Nombre d'octets nécessaires pour N Pokémon */
export function nbOctetsDex(nbPkm = getConfig().game.numberOfPokemon) {
    return Math.max(1, Math.ceil(nbPkm / 8));
}

/**
 * Décode un bitset base64url en Buffer, complété à zéro jusqu'à la taille
 * courante (config numberOfPokemon) : les bits absents valent 0 (non capturé)
 * @param {string|null} b64 - Bitset base64url stocké (null/absent = aucun)
 * @param {number} [nbPkm] - Nombre de slots attendus (défaut: config)
 * @returns {Buffer}
 */
export function decodeDexBits(b64, nbPkm) {
    const taille = nbOctetsDex(nbPkm);
    const bits = Buffer.alloc(taille);
    const buf = Buffer.from(b64 ?? '', 'base64url');
    buf.copy(bits, 0, 0, Math.min(buf.length, taille));
    return bits;
}

/** Encode un Buffer de bits en base64url sans padding (comme LivingDex) */
export function encodeDexBits(bits) {
    return Buffer.from(bits).toString('base64url');
}

/**
 * Pose le bit d'un Pokémon dans le bitset (agrandit le buffer si besoin,
 * pour rester extensible si numberOfPokemon augmente)
 * @param {Buffer} bits - Bitset (modifié ou remplacé si agrandi)
 * @param {number} numPkm - Numéro du Pokémon (1-based)
 * @returns {Buffer} - Le bitset (éventuellement réalloué)
 */
export function setBitDex(bits, numPkm) {
    const i = numPkm - 1;
    if (i < 0) return bits;
    if (i >= bits.length * 8) {
        const grand = Buffer.alloc(Math.ceil((i + 1) / 8));
        bits.copy(grand);
        grand[i >> 3] |= 1 << (i & 7);
        return grand;
    }
    bits[i >> 3] |= 1 << (i & 7);
    return bits;
}

/** Teste si le Pokémon est capturé dans le bitset */
export function aCaptureDex(bits, numPkm) {
    const i = numPkm - 1;
    if (i < 0 || i >= bits.length * 8) return false;
    return (bits[i >> 3] & (1 << (i & 7))) !== 0;
}

/** Nombre de bits à 1 (Pokémon distincts capturés) */
export function popcountDex(bits) {
    let n = 0;
    for (const octet of bits) {
        let x = octet;
        while (x) {
            n += x & 1;
            x >>= 1;
        }
    }
    return n;
}

/**
 * Fallback de relecture : construit le bitset depuis les anciens champs
 * numériques '1'..'N' d'un document non migré
 * @param {Object} row - Document dresseur (legacy)
 * @param {number} [nbPkm] - Nombre de slots (défaut: config)
 * @returns {Buffer}
 */
export function bitsDepuisLegacy(row, nbPkm) {
    const bits = Buffer.alloc(nbOctetsDex(nbPkm));
    for (const [cle, valeur] of Object.entries(row ?? {})) {
        if (/^[0-9]+$/.test(cle) && valeur === 1) {
            setBitDex(bits, Number(cle));
        }
    }
    return bits;
}
