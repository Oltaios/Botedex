/**
 * Tests du chargement du patch note depuis un fichier markdown (PATCHNOTE.md)
 * via release.notesFile, avec repli sur release.notes, et du découpage en
 * messages (limite Discord 2000 caractères).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import '../helpers/env.mjs';
import { getReleaseNotes, lirePatchNote, decouperMessages } from '../../src/utils/configLoader.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const gameConfig = JSON.parse(readFileSync(join(ROOT, 'config/gameConfig.json'), 'utf-8'));

test('release.notesFile pointe vers un fichier markdown existant à la racine', () => {
    const file = gameConfig.release.notesFile;
    assert.ok(file?.endsWith('.md'), `notesFile markdown attendu, reçu : ${file}`);
    assert.ok(existsSync(join(ROOT, file)), `fichier ${file} présent à la racine du projet`);
});

test('getReleaseNotes lit le contenu du fichier markdown', () => {
    const notes = getReleaseNotes();
    const contenuFichier = readFileSync(join(ROOT, gameConfig.release.notesFile), 'utf8').trim();
    assert.equal(notes, contenuFichier, 'contenu identique au fichier');
    assert.ok(notes.length > 100, 'patch note non vide');
});

test('lirePatchNote : repli sur release.notes si le fichier est absent', () => {
    assert.equal(lirePatchNote({ notesFile: 'INEXISTANT.md', notes: 'fallback inline' }, ROOT), 'fallback inline');
    assert.equal(lirePatchNote({}, ROOT), 'Aucune note de version.');
    assert.equal(lirePatchNote({ notes: '  ' }, ROOT), 'Aucune note de version.', 'notes vide -> défaut');
});

test('decouperMessages : respecte la limite de 2000 caractères, coupe entre les blocs', () => {
    assert.deepEqual(decouperMessages('hello'), ['hello']);
    const blocs = Array.from({ length: 10 }, (_, i) => `Bloc ${i} — ${'x'.repeat(500)}`);
    const texte = blocs.join('\n\n'); // ~5100 caractères
    const morceaux = decouperMessages(texte, 2000);
    assert.ok(morceaux.length > 1, 'texte long découpé');
    assert.ok(morceaux.every((m) => m.length <= 2000), 'chaque morceau <= 2000 caractères');
    assert.equal(morceaux.join('\n\n'), texte, 'contenu conservé intégralement');
    // bloc isolé trop long : découpage dur
    const gros = 'y'.repeat(5000);
    const morceauxGros = decouperMessages(gros, 2000);
    assert.equal(morceauxGros.length, 3);
    assert.ok(morceauxGros.every((m) => m.length <= 2000));
});
