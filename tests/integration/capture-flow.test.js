/**
 * Tests d'intégration du flux de capture complet (CaptureService)
 * Fake Discord : messages, channel et collector factices. Base : MongoDB
 * en mémoire. Le tirage de capture (Math.random) est figé pour rendre le
 * résultat déterministe : Pikachu (n°25) avec une pokeball réussit à
 * rng >= 37 (seuil = 100 - 190/3 ≈ 36,7).
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import '../helpers/env.mjs';
import { MongoMemoryServer } from 'mongodb-memory-server';

const mongod = await MongoMemoryServer.create();
process.env.MONGODB_URI = mongod.getUri();

const { client } = await import('../../src/core/client.js');
const { channelService } = await import('../../src/services/channel/ChannelService.js');
const { captureService } = await import('../../src/services/capture/CaptureService.js');
const { bddService } = await import('../../src/services/bdd/BDDService.js');
const {
    getNumPkmAvailable,
    getLockPkmAvailable,
    setNumPkmAvailable,
    clearTentativesCapture,
    pendingResponses
} = await import('../../src/core/client.js');
const { fakeChannel, fakeCollector, fakeMessage } = await import('../helpers/fakeDiscord.mjs');

import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

// Types de ball pilotés par la config : un stock par type, dans l'ordre
const BALL_TYPES = Object.keys(JSON.parse(readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'config', 'gameConfig.json'),
    'utf8'
)).balls);
/** Stocks attendus : { pokeball: 2 } -> un stock par type de la config */
const stocks = (attendus) => BALL_TYPES.map(ballType => attendus[ballType] ?? 0);

const CHANNEL_ID = 'chan-capture';
const NUM_PKM = 25; // Pikachu, taux de capture 190

/** Fige Math.random et retourne la fonction de restauration */
function fixerRandom(valeur) {
    const original = Math.random;
    Math.random = () => valeur;
    return () => {
        Math.random = original;
    };
}

/** Attend qu'une condition asynchrone devienne vraie (délai en ms max) */
async function attendre(condition, delaiMaxMs = 2000) {
    const debut = Date.now();
    while (Date.now() - debut < delaiMaxMs) {
        if (await condition()) return;
        await new Promise((resolve) => setTimeout(resolve, 25));
    }
}

/**
 * Lance un flux de capture et simule le choix de ball du dresseur
 * @returns {Promise<{message: Object, ballChoice: Object}>}
 *          message : la commande !capture (replies dans .replies)
 *          ballChoice : le message de choix de ball (la réponse "pas assez
 *          de ce type" lui est adressée en reply, pas à la commande)
 */
async function lancerCapture({ userId, guildId, rng, choixBall = '!pokeball' }) {
    const collector = fakeCollector();
    const channel = fakeChannel({ id: CHANNEL_ID, collectorFactory: () => collector });
    const message = fakeMessage({ authorId: userId, guildId, channel, content: '!capture' });
    const ballChoice = fakeMessage({ authorId: userId, guildId, channel, content: choixBall });

    const restaurer = rng !== undefined ? fixerRandom(rng) : null;
    try {
        await captureService.gererEventCapture(message, `capture-${userId}`);
        await collector.emit('collect', ballChoice);
        return { message, ballChoice };
    } finally {
        restaurer?.();
    }
}

before(async () => {
    client.user = { id: 'bot-capture' };
    client.channels.cache.set(CHANNEL_ID, fakeChannel({ id: CHANNEL_ID }));
    await channelService.init(CHANNEL_ID);
    await bddService.init();
});

after(async () => {
    setNumPkmAvailable(null);
    clearTentativesCapture();
    await bddService.close();
    await mongod.stop();
});

test('capture réussie : ball décomptée, Pokédex mis à jour, spawn consommé', async () => {
    await bddService.createNewUser('gc1', 'uc1', 'j1');
    await bddService.updateOneFieldForOneUser('gc1', 'uc1', 'pokeball', 3);
    setNumPkmAvailable(NUM_PKM);

    const { message } = await lancerCapture({ userId: 'uc1', guildId: 'gc1', rng: 0.5 });

    assert.deepEqual(await bddService.getBallsForUser('gc1', 'uc1'), stocks({ pokeball: 2 }), 'ball décomptée');
    assert.equal(await bddService.alreadyCaptured('gc1', 'uc1', NUM_PKM), true, 'Pokédex mis à jour');
    assert.equal((await bddService.getDresseur('gc1', 'uc1')).nbrCapture, 1);
    assert.equal(getNumPkmAvailable(), null, 'spawn consommé');
    assert.equal(getLockPkmAvailable(), null, 'lock libéré');
    assert.ok(message.replies.some((r) => String(r).includes('Nouveau Pokémon')));
    assert.ok(message.replies.includes('...'), 'suspens complet en cas de succès');
});

test('capture d\'un doublon : revente au lieu d\'un nouveau champ Pokédex', async () => {
    await bddService.createNewUser('gc2', 'uc2', 'j2');
    await bddService.updateOneFieldForOneUser('gc2', 'uc2', 'pokeball', 2);
    await bddService.registerNewCapture('gc2', 'uc2', NUM_PKM);
    setNumPkmAvailable(NUM_PKM);

    const { message } = await lancerCapture({ userId: 'uc2', guildId: 'gc2', rng: 0.5 });

    assert.ok(message.replies.some((r) => String(r).includes('Team Rocket')), 'message de revente');
    assert.equal(await bddService.getPokedexStateForUser('gc2', 'uc2'), 1, 'Pokédex inchangé');
    assert.equal((await bddService.getDresseur('gc2', 'uc2')).nbrCapture, 2, 'compteur incrémenté');
    // gainMoney n'est pas awaité par CaptureService : on attend l'effet
    await attendre(async () => (await bddService.getMoneyForUser('gc2', 'uc2')) === 600);
});

test('capture ratée : ball perdue, spawn toujours actif', async () => {
    await bddService.createNewUser('gc3', 'uc3', 'j3');
    await bddService.updateOneFieldForOneUser('gc3', 'uc3', 'pokeball', 1);
    setNumPkmAvailable(NUM_PKM);

    const { message } = await lancerCapture({ userId: 'uc3', guildId: 'gc3', rng: 0.05 });

    assert.deepEqual(await bddService.getBallsForUser('gc3', 'uc3'), stocks({}), 'ball perdue quand même');
    assert.equal((await bddService.getDresseur('gc3', 'uc3')).capturesEchouees, 1, 'échec comptabilisé (statistique)');
    assert.equal(await bddService.alreadyCaptured('gc3', 'uc3', NUM_PKM), false, 'Pokédex inchangé');
    assert.equal(getNumPkmAvailable(), NUM_PKM, 'spawn toujours actif');
    assert.equal(getLockPkmAvailable(), 0, 'lock libéré pour les autres');
    assert.ok(message.replies.some((r) => String(r).includes('échappé')));
    // Math.random figé à 0.05 pour tout le flux : tirage raté ET suspens
    // aléatoire tronqué à un seul point (1 à 3 points en cas d'échec)
    assert.equal(message.replies.filter((r) => String(r) === '.').length, 1, 'suspens tronqué à un point');
    assert.ok(!message.replies.some((r) => r === '..' || r === '...'), 'pas de points supplémentaires');
});

test('type de ball épuisé : la capture continue sans décompter', async () => {
    await bddService.createNewUser('gc4', 'uc4', 'j4');
    await bddService.updateOneFieldForOneUser('gc4', 'uc4', 'pokeball', 2);
    setNumPkmAvailable(NUM_PKM);

    const { message, ballChoice } = await lancerCapture({ userId: 'uc4', guildId: 'gc4', rng: 0.5, choixBall: '!Hyperball' });

    // La réponse est adressée au message de choix de ball, pas à la commande
    assert.ok(ballChoice.replies.some((r) => String(r).includes('pas assez de ce type')));
    assert.equal(message.replies.length, 1, 'seule la question d\'inventaire sur la commande');
    assert.deepEqual(await bddService.getBallsForUser('gc4', 'uc4'), stocks({ pokeball: 2 }), 'rien décompté');
    assert.equal(await bddService.alreadyCaptured('gc4', 'uc4', NUM_PKM), false);
});

test('inventaire vide : invitation au shop, spawn intact', async () => {
    await bddService.createNewUser('gc5', 'uc5', 'j5');
    setNumPkmAvailable(NUM_PKM);

    const { message } = await lancerCapture({ userId: 'uc5', guildId: 'gc5' });

    assert.ok(message.replies.some((r) => String(r).includes('poches sont vides')));
    assert.equal(getNumPkmAvailable(), NUM_PKM, 'spawn intact');
    assert.equal(getLockPkmAvailable(), 0, 'lock libéré');
});

test('consolation retirée : plus de récompense pour les perdants du spawn', async () => {
    assert.equal(captureService.distribuerConsolations, undefined, 'distribuerConsolations supprimée du service');
});

test('capture raccourcie : !capture pokeball saute la question et capture directement', async () => {
    await bddService.createNewUser('gc6', 'uc6', 'j6');
    await bddService.updateOneFieldForOneUser('gc6', 'uc6', 'pokeball', 2);
    setNumPkmAvailable(NUM_PKM);

    const channel = fakeChannel({ id: CHANNEL_ID });
    const message = fakeMessage({ authorId: 'uc6', guildId: 'gc6', channel, content: '!capture pokeball' });
    const restaurer = fixerRandom(0.5);
    try {
        await captureService.gererEventCapture(message, `capture-uc6`, 'pokeball');
    } finally {
        restaurer();
    }

    assert.ok(!message.replies.some((r) => String(r).includes('Quelle pokéball')), 'pas de question en mode raccourci');
    assert.ok(message.replies.some((r) => String(r).includes('Nouveau Pokémon')), 'capture effectuée');
    assert.deepEqual(await bddService.getBallsForUser('gc6', 'uc6'), stocks({ pokeball: 1 }), 'ball décomptée');
    assert.equal(await bddService.alreadyCaptured('gc6', 'uc6', NUM_PKM), true, 'Pokédex mis à jour');
    assert.equal(getNumPkmAvailable(), null, 'spawn consommé');
    assert.equal(getLockPkmAvailable(), null, 'lock libéré');
    assert.ok(!pendingResponses.has('capture-uc6'), 'clé libérée');
});

test('capture raccourcie : type de ball inconnu refusé sans rien consommer', async () => {
    await bddService.createNewUser('gc7', 'uc7', 'j7');
    await bddService.updateOneFieldForOneUser('gc7', 'uc7', 'pokeball', 1);
    setNumPkmAvailable(NUM_PKM);

    const channel = fakeChannel({ id: CHANNEL_ID });
    const message = fakeMessage({ authorId: 'uc7', guildId: 'gc7', channel, content: '!capture masterball' });
    await captureService.gererEventCapture(message, `capture-uc7`, 'masterball');

    assert.ok(message.replies.some((r) => String(r).includes('Je ne connais pas ce type de ball')), 'refus');
    assert.ok(message.replies.some((r) => String(r).includes('**!Pokeball**')), 'balls existantes listées (nom d\'affichage)');
    assert.deepEqual(await bddService.getBallsForUser('gc7', 'uc7'), stocks({ pokeball: 1 }), 'rien décompté');
    assert.equal(getNumPkmAvailable(), NUM_PKM, 'spawn intact');
    assert.equal(getLockPkmAvailable(), 0, 'lock libéré');
    assert.ok(!pendingResponses.has('capture-uc7'), 'clé libérée');
});

test('capture raccourcie : ball choisie en stock insuffisant, rien consommé', async () => {
    await bddService.createNewUser('gc8', 'uc8', 'j8');
    await bddService.updateOneFieldForOneUser('gc8', 'uc8', 'superball', 1);
    setNumPkmAvailable(NUM_PKM);

    const channel = fakeChannel({ id: CHANNEL_ID });
    const message = fakeMessage({ authorId: 'uc8', guildId: 'gc8', channel, content: '!capture pokeball' });
    await captureService.gererEventCapture(message, `capture-uc8`, 'pokeball');

    assert.ok(message.replies.some((r) => String(r).includes('pas assez de ce type de ball')), 'refus');
    assert.deepEqual(await bddService.getBallsForUser('gc8', 'uc8'), stocks({ superball: 1 }), 'rien décompté');
    assert.equal(getNumPkmAvailable(), NUM_PKM, 'spawn intact');
    assert.equal(getLockPkmAvailable(), 0, 'lock libéré');
    assert.ok(!pendingResponses.has('capture-uc8'), 'clé libérée');
});

test('MaitreBall : saisie insensible à la casse, capture via la config', async () => {
    await bddService.createNewUser('gc12', 'uc12', 'j12');
    await bddService.updateOneFieldForOneUser('gc12', 'uc12', 'maitreball', 1);
    setNumPkmAvailable(NUM_PKM);

    // Résolution de la saisie vers la clé exacte (minuscule) de la config
    assert.equal(captureService.resoudreBallType('maitreball'), 'maitreball');
    assert.equal(captureService.resoudreBallType('MAITREBALL'), 'maitreball');
    assert.equal(captureService.resoudreBallType('MaitreBall'), 'maitreball', 'saisie avec majuscules résolue');
    assert.equal(captureService.resoudreBallType('masterball'), null, 'type inconnu');

    // Flux complet en raccourci : la MaitreBall (rate 100) capture à coup sûr
    const channel = fakeChannel({ id: CHANNEL_ID });
    const message = fakeMessage({ authorId: 'uc12', guildId: 'gc12', channel, content: '!capture maitreball' });
    const restaurer = fixerRandom(0.05); // RNG faible : seule la MaitreBall réussit
    try {
        await captureService.gererEventCapture(message, `capture-uc12`, 'maitreball');
    } finally {
        restaurer();
    }

    assert.ok(!message.replies.some((r) => String(r).includes('Je ne connais pas ce type de ball')), 'type reconnu');
    assert.ok(message.replies.some((r) => String(r).includes('Nouveau Pokémon')), 'capture réussie');
    assert.deepEqual(await bddService.getBallsForUser('gc12', 'uc12'), stocks({}), 'MaitreBall décomptée');
    assert.equal(getNumPkmAvailable(), null, 'spawn consommé');
});
