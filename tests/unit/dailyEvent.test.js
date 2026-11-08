/**
 * Tests unitaires de DailyEventService (méthodes pures, horloge injectée) :
 * calcul du délai jusqu'au reset de 2h00 locale, dateKey journalière et
 * barre de progression.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../helpers/env.mjs';
import { dailyEventService } from '../../src/services/event/DailyEventService.js';

test('msUntilNextReset : prochaine occurrence de 2h00 en heure locale', () => {
    // resetHour = 2 (config). 1er juin 2025 à 15h00 -> reset le 2 juin à 2h00 = 11h
    assert.equal(dailyEventService.msUntilNextReset(new Date(2025, 5, 1, 15, 0, 0)), 11 * 3600 * 1000);
    // à 1h00 -> reset à 2h00 le même jour = 1h
    assert.equal(dailyEventService.msUntilNextReset(new Date(2025, 5, 1, 1, 0, 0)), 1 * 3600 * 1000);
    // à 2h00 pile -> reset le lendemain à 2h00 = 24h
    assert.equal(dailyEventService.msUntilNextReset(new Date(2025, 5, 1, 2, 0, 0)), 24 * 3600 * 1000);
    // à 2h00:00.001 -> lendemain aussi
    assert.equal(dailyEventService.msUntilNextReset(new Date(2025, 5, 1, 2, 0, 0, 1)), 24 * 3600 * 1000 - 1);
});

test('dateKey : format YYYY-MM-DD en heure locale', () => {
    assert.equal(dailyEventService.dateKey(new Date(2025, 0, 5, 23, 59)), '2025-01-05');
    assert.equal(dailyEventService.dateKey(new Date(2025, 11, 31, 2, 0)), '2025-12-31');
});

test('barreProgression : blocs pleins/vides, ratio borné entre 0 et 1', () => {
    assert.equal(dailyEventService.barreProgression(0, 10), '[░░░░░░░░░░]');
    assert.equal(dailyEventService.barreProgression(0.5, 10), '[█████░░░░░]');
    assert.equal(dailyEventService.barreProgression(1, 10), '[██████████]');
    assert.equal(dailyEventService.barreProgression(2, 10), '[██████████]', 'ratio > 1 borné à 100%');
    assert.equal(dailyEventService.barreProgression(-1, 10), '[░░░░░░░░░░]', 'ratio < 0 borné à 0%');
    assert.equal(dailyEventService.barreProgression(0.2, 10), '[██░░░░░░░░]');
});

test('config dailyEvent : valeurs du spec (100 pts/actif, 5/10/5 pts, 200$, reset 2h)', () => {
    assert.equal(dailyEventService.pointsPerActivePlayer, 100);
    assert.deepEqual(dailyEventService.points, { game: 5, capture: 10, work: 5 });
    assert.equal(dailyEventService.rewardAmount, 200);
    assert.equal(dailyEventService.resetHour, 2);
});
