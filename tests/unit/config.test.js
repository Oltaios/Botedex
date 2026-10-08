/**
 * Tests de cohérence des fichiers de configuration
 * + garde-fou de déploiement : les paquets de test restent en devDependencies
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import '../helpers/env.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const gameConfig = JSON.parse(readFileSync(join(ROOT, 'config/gameConfig.json'), 'utf-8'));
const databaseConfig = JSON.parse(readFileSync(join(ROOT, 'config/database.json'), 'utf-8'));
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf-8'));
const csv = readFileSync(join(ROOT, 'data/pokemonLight.csv'), 'utf-8');

test('gameConfig : structure requise', () => {
    for (const [type, ball] of Object.entries(gameConfig.balls)) {
        assert.equal(typeof ball.nom, 'string', `balls.${type}.nom requis (nom d'affichage)`);
        assert.ok(ball.nom.length > 0, `balls.${type}.nom non vide`);
        assert.equal(type, type.toLowerCase(), `clé balls.${type} en minuscules (utilisée en BDD et pour la saisie)`);
        assert.ok(Number.isFinite(gameConfig.balls[type]?.rate), `balls.${type}.rate requis`);
        assert.ok(Number.isFinite(gameConfig.balls[type]?.price), `balls.${type}.price requis`);
    }
    assert.ok(Number.isFinite(gameConfig.economy.workReward), 'economy.workReward requis');
    assert.ok(Number.isFinite(gameConfig.economy.duplicateCaptureReward), 'economy.duplicateCaptureReward requis');
    assert.ok(Number.isInteger(gameConfig.game.numberOfPokemon), 'game.numberOfPokemon requis');
    assert.ok(
        gameConfig.spawn.minIntervalMinutes <= gameConfig.spawn.maxIntervalMinutes,
        'spawn.minIntervalMinutes <= maxIntervalMinutes'
    );
    assert.ok(typeof gameConfig.release.notes === 'string', 'release.notes requis');
});

test('cohérence : numberOfPokemon === nombre de lignes de données du CSV', () => {
    const dataLines = csv.split(/\r?\n/).filter((l) => l !== '').length - 1;
    assert.equal(gameConfig.game.numberOfPokemon, dataLines);
});

test('admin : adminUserIds est une chaîne (IDs séparés par des virgules)', () => {
    assert.equal(typeof gameConfig.admin?.adminUserIds, 'string', 'admin.adminUserIds requis');
});

test('getAdminUserIds : parse une chaîne d\'IDs séparés par des virgules', async () => {
    const { getAdminUserIds } = await import('../../src/utils/configLoader.js');
    process.env.ADMIN_USER_IDS = ' 111 ,, 222 ,';
    assert.deepEqual(getAdminUserIds(), ['111', '222'], 'espaces et entrées vides ignorées');
    process.env.ADMIN_USER_IDS = '';
    assert.deepEqual(getAdminUserIds(), [], 'liste vide si aucun admin');
    delete process.env.ADMIN_USER_IDS;
});

test('database.json : base et collection dresseurs définies', () => {
    assert.equal(typeof databaseConfig.databaseName, 'string');
    assert.ok(databaseConfig.databaseName.length > 0);
    assert.equal(typeof databaseConfig.collections.dresseurs, 'string');
    assert.ok(databaseConfig.collections.dresseurs.length > 0);
});

test('garde-fou déploiement : mongodb-memory-server hors des dependencies', () => {
    assert.ok(
        pkg.devDependencies?.['mongodb-memory-server'],
        'mongodb-memory-server doit figurer en devDependencies'
    );
    assert.equal(
        pkg.dependencies?.['mongodb-memory-server'],
        undefined,
        'mongodb-memory-server ne doit JAMAIS être en dependencies : ' +
            'il serait installé sur les instances Railway (NODE_ENV=production les exclut sinon)'
    );
});
