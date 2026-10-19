/**
 * Tests d'intégration de la feature œuf (EggService + CaptureService)
 * Fake Discord : un faux channel injecté dans le cache du vrai client
 * (non connecté) + de faux messages. Base : MongoDB en mémoire.
 *
 * Le seuil d'éclosion est lu depuis la config (egg.capturesRequises) : les
 * scénarios s'adaptent à la valeur configurée, que le seuil soit abaissé
 * pour un test rapide ou laissé à sa valeur de jeu.
 *
 * Le tirage du Pokémon offert par l'œuf (Math.random) est figé pour rendre
 * l'éclosion déterministe : Math.random = 0.37 -> RandomUtils.nombreAleatoire
 * (1, 151) donne le Pokémon n°56, Math.random = 0.5 donne le n°76.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import '../helpers/env.mjs';
import { MongoMemoryServer } from 'mongodb-memory-server';

const mongod = await MongoMemoryServer.create();
process.env.MONGODB_URI = mongod.getUri();

// Imports dynamiques APRÈS l'environnement : BDDService fige l'URI à sa
// construction et client.js exige DISCORD_TOKEN au chargement
const { client } = await import('../../src/core/client.js');
const { channelService } = await import('../../src/services/channel/ChannelService.js');
const { eggService } = await import('../../src/services/egg/EggService.js');
const { captureService } = await import('../../src/services/capture/CaptureService.js');
const { bddService } = await import('../../src/services/bdd/BDDService.js');
const { setNumPkmAvailable } = await import('../../src/core/client.js');
const { fakeChannel, fakeMessage } = await import('../helpers/fakeDiscord.mjs');

const CHANNEL_ID = 'chan-egg';
const GUILD = 'guild-egg';
const NUM_PKM = 25; // Pikachu, taux de capture 190 : rng >= ~36,7 réussit
// Seuil d'éclosion piloté par la config egg
const SEUIL = eggService.capturesRequises;
// Paliers des messages d'état flous, calculés comme dans EggService
const PALIER_BOUGE = Math.ceil(SEUIL / 3);
const PALIER_BIENTOT = Math.ceil((SEUIL * 2) / 3);

/** Fige Math.random et retourne la fonction de restauration */
function fixerRandom(valeur) {
    const original = Math.random;
    Math.random = () => valeur;
    return () => {
        Math.random = original;
    };
}

before(async () => {
    client.user = { id: 'bot-egg' };
    client.channels.cache.set(CHANNEL_ID, fakeChannel({ id: CHANNEL_ID }));
    await channelService.init(CHANNEL_ID);
    await bddService.init();
});

after(async () => {
    setNumPkmAvailable(null);
    await bddService.close();
    await mongod.stop();
});

test('donnerOeuf : un seul œuf à la fois, état flou sans jamais révéler le décompte', async () => {
    await bddService.createNewUser(GUILD, 'u-oeuf', 'toto');

    // Pas d'œuf : pas d'état
    assert.equal(await eggService.getEtatOeuf(GUILD, 'u-oeuf'), null);

    assert.equal(await eggService.donnerOeuf(GUILD, 'u-oeuf'), true, 'premier œuf confié');
    assert.equal(await eggService.donnerOeuf(GUILD, 'u-oeuf'), false, 'un seul œuf à la fois');

    // Paliers flous : loin (début), bouge (milieu), bientôt (fin)
    const messages = [await eggService.getEtatOeuf(GUILD, 'u-oeuf')]; // 0 capture
    assert.ok(messages[0].includes('loin'), 'à 0 capture : encore loin de l\'éclosion');

    // Les paliers intermédiaires ne sont visibles que si le seuil les laisse voir
    if (PALIER_BOUGE < SEUIL) {
        for (let i = 0; i < PALIER_BOUGE; i++) {
            assert.equal(await eggService.onCapture(GUILD, 'u-oeuf'), null, 'pas d\'éclosion avant le seuil');
        }
        messages.push(await eggService.getEtatOeuf(GUILD, 'u-oeuf'));
        assert.ok(messages.at(-1).includes('bouge'), `à ${PALIER_BOUGE} captures : l'œuf commence à bouger`);
    }
    if (PALIER_BIENTOT < SEUIL) {
        for (let i = PALIER_BOUGE; i < PALIER_BIENTOT; i++) {
            assert.equal(await eggService.onCapture(GUILD, 'u-oeuf'), null, 'pas d\'éclosion avant le seuil');
        }
        messages.push(await eggService.getEtatOeuf(GUILD, 'u-oeuf'));
        assert.ok(messages.at(-1).includes('bientôt'), `à ${PALIER_BIENTOT} captures : éclôt bientôt`);
    }

    assert.ok(messages.every((m) => typeof m === 'string' && m.length > 0), 'un message affiché à chaque consultation');
    assert.ok(messages.every((m) => !/\d/.test(m)), 'aucun message ne révèle un chiffre');
});

test('onCapture : éclosion au seuil configuré, Pokémon aléatoire ajouté au Pokédex', async () => {
    await bddService.createNewUser(GUILD, 'u-eclosion', 'titi');
    await eggService.donnerOeuf(GUILD, 'u-eclosion');

    // Toutes les captures avant le seuil : pas d'éclosion
    for (let i = 1; i < SEUIL; i++) {
        assert.equal(await eggService.onCapture(GUILD, 'u-eclosion'), null, `pas d'éclosion à la capture ${i}`);
    }
    assert.notEqual(await eggService.getEtatOeuf(GUILD, 'u-eclosion'), null, 'œuf toujours en incubation');

    // Capture du seuil : éclosion déterministe (Math.random = 0.37 -> Pokémon 56)
    const restaurer = fixerRandom(0.37);
    let numEclos;
    try {
        numEclos = await eggService.onCapture(GUILD, 'u-eclosion');
    } finally {
        restaurer();
    }
    assert.equal(numEclos, 56, 'numéro du Pokémon issu de l\'œuf');

    const doc = await bddService.getDresseur(GUILD, 'u-eclosion');
    assert.equal(doc[56], 1, 'Pokémon ajouté au Pokédex');
    assert.equal(doc.nbrCapture, 0, 'l\'éclosion ne compte pas comme une capture');
    assert.equal(doc.oeufsEclos, 1, 'compteur d\'œufs éclos incrémenté');
    assert.equal(await eggService.getEtatOeuf(GUILD, 'u-eclosion'), null, 'œuf consommé');

    // Après l'éclosion, un nouvel œuf peut être confié
    assert.equal(await eggService.donnerOeuf(GUILD, 'u-eclosion'), true);
});

test('capture réussie : la capture du seuil fait éclore l\'œuf et l\'annonce', async () => {
    const userId = 'u-chasseur-oeuf';
    await bddService.createNewUser(GUILD, userId, 'tete');
    await bddService.updateOneFieldForOneUser(GUILD, userId, 'pokeball', 2);
    await eggService.donnerOeuf(GUILD, userId);

    // L'œuf est à une capture de l'éclosion
    for (let i = 0; i < SEUIL - 1; i++) {
        await eggService.onCapture(GUILD, userId);
    }

    // Capture directe "!capture pokeball" avec rng 0.5 : réussie, et l'œuf
    // éclos sur cette capture (Math.random = 0.5 -> Pokémon 76)
    setNumPkmAvailable(NUM_PKM);
    const message = fakeMessage({
        authorId: userId,
        guildId: GUILD,
        channel: fakeChannel({ id: CHANNEL_ID }),
        content: '!capture pokeball'
    });
    const restaurer = fixerRandom(0.5);
    try {
        await captureService.gererEventCapture(message, `capture-${userId}`, 'pokeball');
    } finally {
        restaurer();
    }

    const doc = await bddService.getDresseur(GUILD, userId);
    assert.equal(doc[76], 1, 'Pokémon issu de l\'œuf ajouté au Pokédex');
    assert.equal(doc.eggActive, 0, 'œuf réinitialisé');
    assert.equal(doc.oeufsEclos, 1, 'compteur d\'œufs éclos incrémenté');
    assert.equal(await eggService.getEtatOeuf(GUILD, userId), null, 'plus d\'œuf en incubation');
    assert.ok(message.replies.some((r) => String(r).includes('éclos')), 'éclosion annoncée dans le flux de capture');
    // Message d'éclosion : nom et numéro du Pokémon en gras (ex: **Roucool [16]**)
    assert.ok(
        message.replies.some((r) => /\*\*.*\[76\]\*\*/.test(String(r))),
        'nom + numéro du Pokémon en gras'
    );
});
