/**
 * Tests du contrat du CSV pokemonLight.csv et de son parsing
 *
 * Priorité de non-régression : la colonne `name` doit rester en ANGLAIS
 * (elle alimente la recherche Giphy), le français vit dans `nameFR`.
 * Historique : traduire `name` en français a cassé les GIFs.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import '../helpers/env.mjs';
import { parsingPkm, parsingPkmNomType1Type2 } from '../../src/utils/parsing.js';

const NB_POKEMON = 151;
const NB_CHAMPS = 42;

/** Lignes du CSV sans la ligne vide finale */
function lignes() {
    return readFileSync('./data/pokemonLight.csv', 'utf8').split(/\r?\n/).filter((l) => l !== '');
}

/** Champs d'une ligne, insensible aux virgules internes des champs quotés */
function champs(ligne) {
    return ligne.replace(/"[^"]*"/g, 'Q').split(',');
}

test('contrat parsingPkm : [nom EN, taux de capture, nom FR]', () => {
    assert.deepEqual(parsingPkm(1), ['Bulbasaur', '45', 'Bulbizarre']);
    assert.deepEqual(parsingPkm(25), ['Pikachu', '190', 'Pikachu']);
    assert.deepEqual(parsingPkm(29), ['Nidoran (Femelle)', '235', 'Nidoran♀']);
    assert.deepEqual(parsingPkm(83), ["Farfetch'd", '45', 'Canarticho']);
    assert.deepEqual(parsingPkm(122), ['Mr. Mime', '45', 'M. Mime']);
    assert.deepEqual(parsingPkm(148), ['Dragonair', '45', 'Draco']);
    assert.deepEqual(parsingPkm(151), ['Mew', '45', 'Mew']);
});

test('parsingPkm(null) retourne null (pas de spawn actif)', () => {
    assert.equal(parsingPkm(null), null);
});

test('structure du CSV : 151 lignes, 42 champs, nameFR en dernière colonne', () => {
    const lines = lignes();
    assert.equal(lines.length, NB_POKEMON + 1, 'header + 151 Pokémon');

    const header = champs(lines[0]);
    assert.equal(header.length, NB_CHAMPS);
    assert.equal(header[30], 'name');
    assert.equal(header[41], 'nameFR');

    for (let i = 1; i <= NB_POKEMON; i++) {
        const fields = champs(lines[i]);
        assert.equal(fields.length, NB_CHAMPS, `ligne ${i} : ${fields.length} champs`);
        assert.ok(fields[30]?.trim() !== '', `ligne ${i} : name vide`);
        assert.ok(fields[41]?.trim() !== '', `ligne ${i} : nameFR vide`);
    }
});

test('name reste anglais et nameFR français (échantillon de garde)', () => {
    const lines = lignes();
    const attendus = {
        1: ['Bulbasaur', 'Bulbizarre'],
        4: ['Charmander', 'Salamèche'],
        100: ['Voltorb', 'Voltorbe'],
        130: ['Gyarados', 'Léviator'],
        145: ['Zapdos', 'Électhor']
    };
    for (const [id, [en, fr]] of Object.entries(attendus)) {
        const fields = champs(lines[Number(id)]);
        assert.equal(fields[30], en, `ligne ${id} : colonne name`);
        assert.equal(fields[41], fr, `ligne ${id} : colonne nameFR`);
    }
});

test('contrat parsingPkmNomType1Type2 : nom EN et types FR', () => {
    assert.deepEqual(parsingPkmNomType1Type2(25), { nomPoke: 'Pikachu', type_1: 'electrik', type_2: '' });
    assert.deepEqual(parsingPkmNomType1Type2(6), { nomPoke: 'Charizard', type_1: 'feu', type_2: 'vol' });
});

test('types du CSV : 18 types français, aucun reste anglais', () => {
    const attendus = new Set([
        'normal', 'feu', 'eau', 'electrik', 'plante', 'glace', 'combat', 'poison',
        'sol', 'vol', 'psy', 'insecte', 'roche', 'spectre', 'dragon', 'tenebres',
        'acier', 'fee'
    ]);
    const vus = new Set();
    const lines = lignes();
    for (let i = 1; i <= NB_POKEMON; i++) {
        const fields = champs(lines[i]);
        if (fields[36]) vus.add(fields[36]);
        if (fields[37]) vus.add(fields[37]);
    }
    for (const type of vus) {
        assert.ok(attendus.has(type), `type inattendu dans le CSV : "${type}" (reste anglais ?)`);
    }
    assert.equal(vus.size, attendus.size, 'les 18 types doivent apparaître dans la génération 1');
});
