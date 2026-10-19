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

test('!pokedex renvoie le compte et le lien de checklist LivingDex', async () => {
    const message = fakeMessage({ authorId: 'u-inscrit', guildId: GUILD, content: '!pokedex' });
    await handle(message);
    const reply = String(message.replies[0] ?? '');
    assert.ok(reply.includes('capturés : 0'), 'compte de captures');
    assert.ok(reply.includes('https://livingdex.app/?game=rby#s='), 'lien LivingDex autoporteur');
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

test('!classement : pokedex par défaut, captures en argument, critère inconnu refusé', async () => {
    // Second dresseur avec une capture distincte + un doublon revendu
    const inscription = fakeMessage({
        authorId: 'u-chasseur',
        username: 'chasseur',
        guildId: GUILD,
        content: INSCRIPTION
    });
    await handle(inscription);
    assert.ok(inscription.replies.some((r) => String(r).includes('Compte créé')));
    await bddService.registerNewCapture(GUILD, 'u-chasseur', 25);
    await bddService.incrementCaptureCount(GUILD, 'u-chasseur');

    // Sans argument : critère pokedex, chasseur (1) devant toto (0)
    const parDefaut = fakeMessage({ authorId: 'u-inscrit', guildId: GUILD, content: '!classement' });
    await handle(parDefaut);
    const replyDefaut = String(parDefaut.replies[0] ?? '');
    assert.ok(replyDefaut.includes('Pokémon capturés'), 'critère pokedex par défaut');
    assert.ok(replyDefaut.indexOf('chasseur') < replyDefaut.indexOf('toto'), 'tri par score décroissant');
    assert.ok(replyDefaut.includes('1 Pokémon'), 'score du chasseur');

    // Argument captures : doublons inclus (2 captures pour le chasseur)
    const parCaptures = fakeMessage({ authorId: 'u-inscrit', guildId: GUILD, content: '!classement captures' });
    await handle(parCaptures);
    const replyCaptures = String(parCaptures.replies[0] ?? '');
    assert.ok(replyCaptures.includes('captures effectuées'), 'critère captures');
    assert.ok(replyCaptures.includes('2 captures'), 'doublons comptés');

    // Critère inconnu : usage rappelé
    const mauvais = fakeMessage({ authorId: 'u-inscrit', guildId: GUILD, content: '!classement bidule' });
    await handle(mauvais);
    assert.ok(mauvais.replies.some((r) => String(r).includes('Critère inconnu')));
});

test('!classement egg : classement par œufs éclos', async () => {
    // u-chasseur fait éclore un œuf : 1 éclosion contre 0 pour les autres
    await bddService.giveEgg(GUILD, 'u-chasseur');
    for (let i = 0; i < 10; i++) {
        await bddService.progressEgg(GUILD, 'u-chasseur');
    }
    assert.equal(await bddService.hatchEgg(GUILD, 'u-chasseur', 42, 10), 0);

    const message = fakeMessage({ authorId: 'u-inscrit', guildId: GUILD, content: '!classement egg' });
    await handle(message);
    const reply = String(message.replies[0] ?? '');
    assert.ok(reply.includes('œufs éclos'), 'critère egg');
    assert.ok(reply.indexOf('chasseur') < reply.indexOf('toto'), 'le dresseur avec une éclosion mène');
    assert.ok(reply.includes('1 œuf éclos'), 'affichage au singulier pour un seul œuf');
});

test('!egg : état sans œuf, obtenir, état flou, action inconnue', async () => {
    await bddService.createNewUser(GUILD, 'u-oeuf-routage', 'oeufiste');

    const sansOeuf = fakeMessage({ authorId: 'u-oeuf-routage', guildId: GUILD, content: '!egg' });
    await handle(sansOeuf);
    assert.ok(sansOeuf.replies.some((r) => String(r).includes("pas d'œuf")), 'sans œuf : orienté vers !egg obtenir');

    const obtenir = fakeMessage({ authorId: 'u-oeuf-routage', guildId: GUILD, content: '!egg obtenir' });
    await handle(obtenir);
    assert.ok(obtenir.replies.some((r) => String(r).includes('Professeur Chen')), 'œuf confié par le Professeur Chen');

    const avecOeuf = fakeMessage({ authorId: 'u-oeuf-routage', guildId: GUILD, content: '!egg' });
    await handle(avecOeuf);
    assert.ok(avecOeuf.replies.some((r) => String(r).includes('éclosion')), 'état flou affiché sans décompte');

    const inconnu = fakeMessage({ authorId: 'u-oeuf-routage', guildId: GUILD, content: '!egg casser' });
    await handle(inconnu);
    assert.ok(inconnu.replies.some((r) => String(r).includes('Action inconnue')), 'action inconnue refusée');
});
