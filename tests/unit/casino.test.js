/**
 * Tests du casino clandestin (src/services/economy/CasinoService.js)
 * Priorités : l'espérance de retour reste STRICTEMENT inférieure à 1
 * (le casino doit détruire de l'argent, c'est un money sink), bornes de
 * mise respectées, tirage conforme à la table des lots de la config.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import '../helpers/env.mjs';
import { casinoService } from '../../src/services/economy/CasinoService.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const gameConfig = JSON.parse(readFileSync(join(ROOT, 'config/gameConfig.json'), 'utf-8'));

test('config casino : structure requise', () => {
    const casino = gameConfig.casino;
    assert.ok(Number.isInteger(casino?.minBet), 'casino.minBet requis (entier)');
    assert.ok(Number.isInteger(casino?.maxBet), 'casino.maxBet requis (entier)');
    assert.ok(casino.minBet >= 1, 'minBet >= 1');
    assert.ok(casino.maxBet >= casino.minBet, 'maxBet >= minBet');
    assert.ok(Number.isFinite(casino?.responseTimeMs), 'casino.responseTimeMs requis');
    assert.ok(Array.isArray(casino?.payouts) && casino.payouts.length > 0, 'casino.payouts requis');
});

test('espérance de retour strictement négative (money sink)', () => {
    const expectedReturn = casinoService.getExpectedReturn();
    assert.ok(expectedReturn > 0, `gain possible attendu, obtenu ${expectedReturn}`);
    assert.ok(expectedReturn < 1, `l'espérance doit être < 1 (perte en moyenne), obtenue ${expectedReturn}`);
    // La probabilité de perte sèche complète la table à 100%
    const totalChance = casinoService.getPayouts().reduce((sum, p) => sum + p.chance, 0);
    assert.ok(casinoService.getLossChance() > 0, 'au moins un tirage perdant doit exister');
    assert.ok(Math.abs(totalChance + casinoService.getLossChance() - 1) < 1e-9, 'les chances totalisent 100%');
});

test('validateBet : bornes de la config respectées', () => {
    assert.equal(casinoService.validateBet(casinoService.getMinBet()).valid, true);
    assert.equal(casinoService.validateBet(casinoService.getMaxBet()).valid, true);
    assert.equal(casinoService.validateBet(casinoService.getMinBet() - 1).valid, false);
    assert.equal(casinoService.validateBet(casinoService.getMaxBet() + 1).valid, false);
    assert.equal(casinoService.validateBet(3.5).valid, false, 'mise non entière refusée');
    assert.equal(casinoService.validateBet(NaN).valid, false);
});

test('drawPayout : tirage conforme à la table des lots', (t) => {
    const payouts = casinoService.getPayouts();
    // rng croissant : chaque lot tombe dans sa tranche de chance cumulée
    let cumulative = 0;
    for (const payout of payouts) {
        const inside = cumulative + payout.chance / 2; // au milieu de la tranche
        const boundary = cumulative + payout.chance - 1e-9; // juste avant la borne
        let mock = t.mock.method(Math, 'random', () => inside);
        assert.equal(casinoService.drawPayout().label, payout.label);
        mock.mock.restore();
        mock = t.mock.method(Math, 'random', () => boundary);
        assert.equal(casinoService.drawPayout().multiplier, payout.multiplier);
        mock.mock.restore();
        cumulative += payout.chance;
    }
    // Au-delà de la table : perte sèche
    const mock = t.mock.method(Math, 'random', () => 0.999999);
    const loss = casinoService.drawPayout();
    mock.mock.restore();
    assert.equal(loss.multiplier, 0);
    assert.equal(loss.label, 'Perdu');
});

test('sanité statistique : fréquences et moyenne empiriques proches de la théorie', () => {
    const labels = new Set(casinoService.getPayouts().map(p => p.label));
    labels.add('Perdu');
    const draws = 100000;
    let totalReturned = 0;
    let losses = 0;
    for (let i = 0; i < draws; i++) {
        const payout = casinoService.drawPayout();
        assert.ok(labels.has(payout.label), `lot inconnu : ${payout.label}`);
        totalReturned += payout.multiplier;
        if (payout.multiplier === 0) losses++;
    }
    const lossFrequency = losses / draws;
    const empiricalReturn = totalReturned / draws;
    const expectedLoss = casinoService.getLossChance();
    assert.ok(Math.abs(lossFrequency - expectedLoss) < 0.01, `fréquence de perte ${lossFrequency} vs ${expectedLoss}`);
    const expectedReturn = casinoService.getExpectedReturn();
    assert.ok(Math.abs(empiricalReturn - expectedReturn) < 0.05, `retour moyen ${empiricalReturn} vs ${expectedReturn}`);
});
