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
    for (const type of ['pokeball', 'superball', 'hyperball']) {
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
