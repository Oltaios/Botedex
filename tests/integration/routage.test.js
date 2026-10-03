/**
 * Tests d'intégration du routage des commandes (messageCreate)
 * Fake Discord : un faux channel injecté dans le cache du vrai client
 * (non connecté) + de faux messages. Base : MongoDB en mémoire.
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
const { handle } = await import('../../src/events/messageCreate.js');
const { bddService } = await import('../../src/services/bdd/BDDService.js');
const { fakeChannel, fakeMessage } = await import('../helpers/fakeDiscord.mjs');

const CHANNEL_ID = 'chan-test';
const BOT_ID = 'bot-123';
const INSCRIPTION = '!jeVeuxJouerStpCreeMoiUnComptePourquoiCetteCommandeEstSiLongueJeHaisLesDevs';
const GUILD = 'guild-routage';
let channel;

before(async () => {
    // Le client n'est pas connecté : on lui fournit un utilisateur et un
    // channel factices (le cache accepte n'importe quel objet)
    client.user = { id: BOT_ID };
    channel = fakeChannel({ id: CHANNEL_ID });
    client.channels.cache.set(CHANNEL_ID, channel);
    await channelService.init(CHANNEL_ID);
    await bddService.init();
});

after(async () => {
    await bddService.close();
    await mongod.stop();
});

test('ignore les messages du bot lui-même', async () => {
    const message = fakeMessage({ authorId: BOT_ID, content: '!ping' });
    await handle(message);
    assert.equal(message.replies.length, 0);
});

test('ignore les messages hors du channel principal', async () => {
    const autre = fakeChannel({ id: 'chan-autre' });
    const message = fakeMessage({ channel: autre, content: '!ping' });
    await handle(message);
    assert.equal(message.replies.length, 0);
});

test('!ping répond Pong sans enregistrement', async () => {
    const message = fakeMessage({ authorId: 'u-ping', content: '!ping' });
    await handle(message);
    assert.equal(message.replies.length, 1);
    assert.equal(String(message.replies[0]), 'Pong.');
});

test('la commande d\'inscription crée un dresseur avec la clé composite', async () => {
    const message = fakeMessage({
        authorId: 'u-inscrit',
        username: 'toto',
        guildId: GUILD,
        content: INSCRIPTION
    });
    await handle(message);
    assert.ok(message.replies.some((r) => String(r).includes('Compte créé')));

    const doc = await bddService.getDresseur(GUILD, 'u-inscrit');
    assert.ok(doc, 'document créé dans la base');
    assert.deepEqual(Object.keys(doc._id), ['guildId', 'userId']);
    assert.equal(doc._id.guildId, GUILD);
    assert.equal(doc._id.userId, 'u-inscrit');

    // Deuxième tentative : refus, pas de doublon
    const bis = fakeMessage({ authorId: 'u-inscrit', guildId: GUILD, content: INSCRIPTION });
    await handle(bis);
    assert.ok(bis.replies.some((r) => String(r).includes('already exists')));
    assert.equal(await bddService.getPokedexStateForUser(GUILD, 'u-inscrit'), 0, 'un seul document');
});

test('commandes réservées : refus si non enregistré, accès sinon', async () => {
    const inconnu = fakeMessage({ authorId: 'u-inconnu', guildId: GUILD, content: '!money' });
    await handle(inconnu);
    assert.ok(inconnu.replies.some((r) => String(r).includes("n'apparais pas")));

    const inscrit = fakeMessage({ authorId: 'u-inscrit', guildId: GUILD, content: '!money' });
    await handle(inscrit);
    assert.ok(inscrit.replies.some((r) => String(r).includes('500')), 'solde initial affiché');
});

test('isolation : enregistré sur un serveur ne l\'est pas sur un autre', async () => {
    const message = fakeMessage({ authorId: 'u-inscrit', guildId: 'guild-autre', content: '!money' });
    await handle(message);
    assert.ok(message.replies.some((r) => String(r).includes("n'apparais pas")));
});

test('commande inconnue après enregistrement', async () => {
    const message = fakeMessage({ authorId: 'u-inscrit', guildId: GUILD, content: '!flute' });
    await handle(message);
    assert.ok(message.replies.some((r) => String(r).includes('Commande inconnue')));
});
