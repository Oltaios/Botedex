/**
 * Tests du modèle Ball, notamment getRateContre() pour les balls à
 * efficacité typée (typesEfficaces en config) : rateEfficace si le Pokémon
 * a au moins un type de la liste, sinon rate de base. Les balls classiques
 * (sans typesEfficaces) gardent leur rate en permanence.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../helpers/env.mjs';
import { Ball } from '../../src/models/Ball.js';

test('Ball classique (sans typesEfficaces) : getRateContre retourne toujours le rate de base', () => {
    const hyperball = new Ball('hyperball');
    assert.equal(hyperball.getRateContre('feu', 'vol'), 1.9);
    assert.equal(hyperball.getRateContre('eau', ''), 1.9);
    assert.equal(hyperball.getRateContre('plante', 'poison'), 1.9);
    assert.equal(new Ball('pokeball').getRateContre('plante', ''), 1);
    assert.equal(new Ball('maitreball').getRateContre('psy', ''), 100);
});

test('Ball typée : rateEfficace si au moins un type du Pokémon correspond', () => {
    const monsanto = new Ball('monsantoball'); // plante/insecte
    assert.equal(monsanto.getRateContre('plante', 'poison'), 2, 'type1 correspond');
    assert.equal(monsanto.getRateContre('normal', 'insecte'), 2, 'type2 correspond');
    assert.equal(monsanto.getRateContre('insecte', ''), 2, 'monotype correspond');
    assert.equal(monsanto.getRateContre('feu', ''), 1, 'aucun type ne correspond -> rate de base');
    assert.equal(monsanto.getRateContre('eau', 'roche'), 1, 'double type sans correspondance -> rate de base');

    const dry = new Ball('dryball'); // eau
    assert.equal(dry.getRateContre('eau', ''), 2);
    assert.equal(dry.getRateContre('plante', 'eau'), 2, 'correspondance en type2');
    assert.equal(dry.getRateContre('roche', 'acier'), 1);

    const foret = new Ball('foretball'); // roche/acier
    assert.equal(foret.getRateContre('acier', 'vol'), 2);
    assert.equal(foret.getRateContre('roche', ''), 2);
    assert.equal(foret.getRateContre('feu', 'sol'), 1);

    const tisanerie = new Ball('tisanerieball'); // feu/sol
    assert.equal(tisanerie.getRateContre('sol', 'roche'), 2);
    assert.equal(tisanerie.getRateContre('feu', ''), 2);
    assert.equal(tisanerie.getRateContre('plante', 'insecte'), 1);
});

test('Ball typée : comparaison des types insensible à la casse', () => {
    const monsanto = new Ball('monsantoball');
    assert.equal(monsanto.getRateContre('Plante', 'Poison'), 2);
});
