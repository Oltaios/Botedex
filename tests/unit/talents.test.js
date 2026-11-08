/**
 * Tests de la traduction des talents dans le CSV : la colonne abilities de
 * data/pokemonLight.csv est directement en français (source pokebip).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../helpers/env.mjs';
import { parsingPkmAbilities, parsingToutesAbilities } from '../../src/utils/parsing.js';

test('abilities du CSV : Bulbizarre en français', () => {
    assert.deepEqual(parsingPkmAbilities(1), ['Engrais', 'Chlorophylle']);
    assert.deepEqual(parsingPkmAbilities(25), ['Statik', 'Paratonnerre']);
    assert.deepEqual(parsingPkmAbilities(null), []);
});

test('abilities du CSV : plus aucun nom anglais résiduel', () => {
    const tous = parsingToutesAbilities();
    assert.ok(tous.length >= 130, `pool conséquent (${tous.length} talents distincts)`);
    // Noms anglais connus du CSV d'origine : ne doivent plus apparaître
    for (const en of ['Overgrow', 'Chlorophyll', 'Static', 'Lightningrod', 'Levitate', 'Wonder Skin', 'Intimidate']) {
        assert.ok(!tous.includes(en), `talent anglais résiduel : ${en}`);
    }
    // Exemples de traductions pokebip attendues
    assert.ok(tous.includes('Engrais'));
    assert.ok(tous.includes('Chlorophylle'));
    assert.ok(tous.includes('Statik'));
    assert.ok(tous.includes('Paratonnerre'));
    assert.ok(tous.includes('Lévitation'));
    assert.ok(tous.includes('Œil Composé'));
    assert.ok(tous.includes('Peau Miracle'));
    // Toutes les entrées non vides et sans espace parasite
    assert.ok(tous.every((t) => t.length > 0 && t === t.trim()), 'talents non vides et trimés');
});
