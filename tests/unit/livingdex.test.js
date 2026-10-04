/**
 * Tests du générateur de liens LivingDex (src/utils/livingdex.js)
 * Le décodeur de contrôle reproduit la logique de decodeCaughtState de
 * l'app (js/storage.js) : extraction du hash, base64url, inflate, bitset.
 * Un round-trip réussi valide que le lien produit est au format attendu
 * par https://livingdex.app.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inflateSync } from 'node:zlib';
import '../helpers/env.mjs';
import { construireLienDex } from '../../src/utils/livingdex.js';

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
    for (let i = 1; i <= 151; i++) doc[i] = 0;
    for (const num of captures) doc[num] = 1;
    return doc;
}

test('lien : préfixe LivingDex avec le jeu rby et un hash compact', () => {
    const lien = construireLienDex(docAvec([1, 25, 151]));
    assert.ok(lien.startsWith('https://livingdex.app/?game=rby#s='), lien);
    assert.ok(lien.length < 500, `lien trop long : ${lien.length} caractères`);
});

test('payload au schéma de partage v2 de l\'app', () => {
    const { payload } = decoderLien(construireLienDex(docAvec([1, 25, 149, 151])));
    assert.equal(payload.version, 2, 'version du schéma');
    assert.equal(payload.gameId, 'rby', 'jeu Red/Blue/Yellow');
    assert.deepEqual(payload.segments, ['kanto'], 'segment Kanto');
    assert.equal(payload.slotCount, 151, '151 slots');
});

test('round-trip : les captures du dresseur sont dans le bitset', () => {
    const captures = [1, 4, 25, 100, 149, 151];
    const { captures: relues } = decoderLien(construireLienDex(docAvec(captures)));
    assert.deepEqual(relues, captures);
});

test('dresseur sans document : checklist vide valide', () => {
    const { payload, captures } = decoderLien(construireLienDex(null));
    assert.equal(payload.slotCount, 151);
    assert.deepEqual(captures, []);
});

test('pokédex complet : les 151 slots capturés', () => {
    const tous = Array.from({ length: 151 }, (_, i) => i + 1);
    const { captures } = decoderLien(construireLienDex(docAvec(tous)));
    assert.equal(captures.length, 151);
});

test('robustesse : valeurs non binaires ignorées, index hors bornes ignorés', () => {
    const doc = docAvec([3, 7]);
    doc[25] = 2;   // valeur invalide : ne doit pas compter comme capture
    doc[999] = 1;   // hors génération 1 : ignoré
    const { captures } = decoderLien(construireLienDex(doc));
    assert.deepEqual(captures, [3, 7]);
});
