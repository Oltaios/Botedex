/**
 * Tests du générateur de phrases aléatoires
 * Math.random est figé par test pour rendre les tirages déterministes.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../helpers/env.mjs';
import { PhrasesAleatoires } from '../../src/utils/phrasesAleatoires.js';

test('gabarit invalide rejeté', () => {
    assert.throws(() => new PhrasesAleatoires(['ok', '']), /Gabarit invalide/);
    assert.throws(() => new PhrasesAleatoires([42]), /Gabarit invalide/);
});

test('substitution des paramètres', (t) => {
    t.mock.method(Math, 'random', () => 0);
    const pool = new PhrasesAleatoires(['Un {nomPoke} apparaît !']);
    assert.equal(pool.piocher({ nomPoke: 'Bulbizarre' }), 'Un Bulbizarre apparaît !');
});

test('anti-répétition : jamais deux fois la même phrase de suite', (t) => {
    t.mock.method(Math, 'random', () => 0);
    const pool = new PhrasesAleatoires(['PHRASE_A', 'PHRASE_B']);
    // random = 0 donne toujours l'index 0 : l'anti-répétition doit décaler
    assert.equal(pool.piocher(), 'PHRASE_A');
    assert.equal(pool.piocher(), 'PHRASE_B');
    assert.equal(pool.piocher(), 'PHRASE_A');
});

test('phrase rare tirée quand le tirage est >= 95', (t) => {
    t.mock.method(Math, 'random', () => 0.99);
    const pool = new PhrasesAleatoires(['COMMUNE'], ['RARE']);
    assert.equal(pool.piocher(), 'RARE');
});

test('pool commun vide : phrase vide, même en cas de tirage rare', (t) => {
    t.mock.method(Math, 'random', () => 0);
    const pool = new PhrasesAleatoires([], ['RARE']);
    assert.equal(pool.piocher(), '');
});

test('taille du pool', () => {
    const pool = new PhrasesAleatoires(['a', 'b', 'c']);
    assert.equal(pool.taille, 3);
});
