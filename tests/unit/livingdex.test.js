/**
 * Tests du générateur de liens LivingDex (src/utils/livingdex.js)
 *
 * Le décodeur de contrôle reproduit la logique de decodeCaughtState de
 * l'app (js/storage.js) : extraction du hash, base64url, inflate, bitset.
 * Un round-trip réussi valide que le lien produit est au format attendu
 * par https://livingdex.app.
 *
 * Jeu ciblé : "gsc" (dex Johto), slotCount = game.numberOfPokemon (251,
 * générations 1+2) lu depuis la config.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inflateSync } from 'node:zlib';
import { readFileSync } from 'fs';
import '../helpers/env.mjs';
import { construireLienDex } from '../../src/utils/livingdex.js';
import { encodeDexBits, setBitDex, decodeDexBits, nbOctetsDex } from '../../src/utils/dexBits.js';

const NB_POKEMON = JSON.parse(readFileSync('config/gameConfig.json', 'utf8')).game.numberOfPokemon;

/** Reproduit le décodage de l'app à partir du hash #s=... */
function decoderLien(lien) {
    const match = /#s=([^&]+)/.exec(lien);
    assert.ok(match, 'hash #s= présent');
    const base64 = match[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
    const payload = JSON.parse(inflateSync(Buffer.from(padded, 'base64')).toString('utf8'));
    const bits = Buffer.from(payload.bits.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
    const captures = [];
    for (let slot = 1; slot <= payload.slotCount; slot++) {
        const i = slot - 1;
        if ((bits[i >> 3] & (1 << (i & 7))) !== 0) captures.push(slot);
    }
    return { payload, captures };
}

/** Document dresseur factice avec les captures indiquées */
function docAvec(captures = []) {
    const doc = {};
    for (let i = 1; i <= NB_POKEMON; i++) doc[i] = 0;
    for (const num of captures) doc[num] = 1;
    return doc;
}

test('lien : préfixe LivingDex avec le jeu gsc et un hash compact', () => {
    const lien = construireLienDex(docAvec([1, 25, NB_POKEMON]));
    assert.ok(lien.startsWith('https://livingdex.app/?game=gsc#s='), lien);
    assert.ok(lien.length < 500, `lien trop long : ${lien.length} caractères`);
});

test('payload au schéma de partage v2 de l\'app', () => {
    const { payload } = decoderLien(construireLienDex(docAvec([1, 25, 149, NB_POKEMON])));
    assert.equal(payload.version, 2, 'version du schéma');
    assert.equal(payload.gameId, 'gsc', 'jeu Gold/Silver/Crystal');
    assert.deepEqual(payload.segments, ['johto'], 'segment Johto');
    assert.equal(payload.slotCount, NB_POKEMON, `${NB_POKEMON} slots`);
});

test('round-trip : les captures du dresseur sont dans le bitset', () => {
    const captures = [1, 4, 25, 100, 149, NB_POKEMON];
    const { captures: relues } = decoderLien(construireLienDex(docAvec(captures)));
    assert.deepEqual(relues, captures);
});

test('dresseur sans document : checklist vide valide', () => {
    const { payload, captures } = decoderLien(construireLienDex(null));
    assert.equal(payload.slotCount, NB_POKEMON);
    assert.deepEqual(captures, []);
});

test('pokédex complet : tous les slots capturés', () => {
    const tous = Array.from({ length: NB_POKEMON }, (_, i) => i + 1);
    const { captures } = decoderLien(construireLienDex(docAvec(tous)));
    assert.equal(captures.length, NB_POKEMON);
});

test('lien depuis le champ dexBits (format migré, même encodage)', () => {
    let bits = decodeDexBits(null, NB_POKEMON); // buffer plein de 0, taille config
    bits = setBitDex(bits, 1);
    bits = setBitDex(bits, 25);
    bits = setBitDex(bits, NB_POKEMON);
    const doc = { dexBits: encodeDexBits(bits) };
    const { payload, captures } = decoderLien(construireLienDex(doc));
    assert.equal(payload.slotCount, NB_POKEMON);
    assert.deepEqual(captures, [1, 25, NB_POKEMON], 'mêmes captures que le format legacy');
});

test('robustesse : valeurs non binaires ignorées, index hors dex ignorés', () => {
    const doc = docAvec([3, 7]);
    doc[25] = 2;            // valeur invalide : ne doit pas compter comme capture
    doc[NB_POKEMON + 1] = 1; // hors dex : ignoré
    const { captures } = decoderLien(construireLienDex(doc));
    assert.deepEqual(captures, [3, 7]);
});
