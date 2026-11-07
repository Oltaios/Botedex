/**
 * Tests du bitset Pokédex compact (src/utils/dexBits.js) :
 * encodage base64url (identique au lien LivingDex), décodage avec padding
 * à zéro (extensible quand numberOfPokemon augmente), set/test de bit,
 * popcount et repli legacy.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import '../helpers/env.mjs';
import {
    nbOctetsDex, decodeDexBits, encodeDexBits,
    setBitDex, aCaptureDex, popcountDex, bitsDepuisLegacy
} from '../../src/utils/dexBits.js';

const NB_POKEMON = JSON.parse(readFileSync('config/gameConfig.json', 'utf8')).game.numberOfPokemon;

test('nbOctetsDex : taille dérivée du nombre de Pokémon', () => {
    assert.equal(nbOctetsDex(251), 32);
    assert.equal(nbOctetsDex(256), 32);
    assert.equal(nbOctetsDex(257), 33);
    assert.equal(nbOctetsDex(NB_POKEMON), 32);
});

test('round-trip encode/decode + set/test de bit (LSB-first, comme LivingDex)', () => {
    let bits = Buffer.alloc(nbOctetsDex(NB_POKEMON));
    bits = setBitDex(bits, 1);
    bits = setBitDex(bits, 25);
    bits = setBitDex(bits, 251);
    assert.equal(aCaptureDex(bits, 1), true);
    assert.equal(aCaptureDex(bits, 25), true);
    assert.equal(aCaptureDex(bits, 251), true);
    assert.equal(aCaptureDex(bits, 2), false);
    assert.equal(aCaptureDex(bits, 252), false, 'hors bornes = non capturé');

    const b64 = encodeDexBits(bits);
    assert.equal(b64.length, 43, '32 octets -> 43 caractères base64url sans padding');
    const relu = decodeDexBits(b64);
    assert.equal(aCaptureDex(relu, 25), true, 'round-trip');
    assert.equal(popcountDex(relu), 3);
});

test('extensibilité : un ancien bitset 32 octets se décode à 49 octets (386 Pokémon) avec bits à 0', () => {
    let bits = Buffer.alloc(32);
    bits = setBitDex(bits, 200);
    const b64 = encodeDexBits(bits); // document "ancien", 251 Pokémon
    const grand = decodeDexBits(b64, 386); // config passée à 386
    assert.equal(grand.length, 49, 'buffer grandi');
    assert.equal(aCaptureDex(grand, 200), true, 'bit existant conservé');
    assert.equal(aCaptureDex(grand, 386), false, 'nouveau Pokémon = non capturé (padding 0)');
    assert.equal(popcountDex(grand), 1);
});

test('setBitDex agrandit le buffer si le numéro dépasse la capacité', () => {
    let bits = Buffer.alloc(32);
    bits = setBitDex(bits, 300); // > 256 bits
    assert.equal(bits.length, 38);
    assert.equal(aCaptureDex(bits, 300), true);
});

test('bitsDepuisLegacy : repli depuis les anciens champs numériques', () => {
    const row = { _id: { guildId: 'g', userId: 'u' }, name: 'x', argent: 500, '1': 1, '25': 1, '42': 0, '999': 1 };
    const bits = bitsDepuisLegacy(row);
    assert.equal(aCaptureDex(bits, 1), true);
    assert.equal(aCaptureDex(bits, 25), true);
    assert.equal(aCaptureDex(bits, 42), false, 'valeur 0 = non capturé');
    assert.equal(popcountDex(bits), 2, 'champs hors bornes (999) ignorés, champs non numériques ignorés');
});
