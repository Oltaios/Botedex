/**
 * Tests des utilitaires d'aléatoire
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../helpers/env.mjs';
import { RandomUtils } from '../../src/utils/randomUtils.js';

test('bornes inclusives', (t) => {
    t.mock.method(Math, 'random', () => 0);
    assert.equal(RandomUtils.nombreAleatoire(3, 7), 3);
});

test('borne supérieure atteinte', (t) => {
    t.mock.method(Math, 'random', () => 0.9999);
    assert.equal(RandomUtils.nombreAleatoire(3, 7), 7);
});

test('min === max accepté', (t) => {
    t.mock.method(Math, 'random', () => 0.5);
    assert.equal(RandomUtils.nombreAleatoire(5, 5), 5);
});

test('bornes invalides rejetées', () => {
    assert.throws(() => RandomUtils.nombreAleatoire(1.5, 7), /Bornes invalides/);
    assert.throws(() => RandomUtils.nombreAleatoire(8, 7), /Intervalle invalide/);
});

test('les tirages restent dans l\'intervalle (sanity)', () => {
    for (let i = 0; i < 500; i++) {
        const value = RandomUtils.nombreAleatoire(1, 151);
        assert.ok(value >= 1 && value <= 151 && Number.isInteger(value));
    }
});
