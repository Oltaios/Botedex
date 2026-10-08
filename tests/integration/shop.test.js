/**
 * Tests d'intégration du raccourci d'achat de la commande !shop :
 * "!shop <ball><nombre>" achète directement sans passer par la vitrine
 * (même mécanique de raccourci que !capture <ball>).
 * Base : MongoDB en mémoire, fake Discord (channel + messages).
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import '../helpers/env.mjs';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

// Prix des balls pilotés par la config (aucun montant codé en dur ici)
const gameConfig = JSON.parse(readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'config', 'gameConfig.json'),
    'utf8'
));

const mongod = await MongoMemoryServer.create();
process.env.MONGODB_URI = mongod.getUri();

// Imports dynamiques APRÈS l'environnement : BDDService fige l'URI à sa
// construction et client.js exige DISCORD_TOKEN au chargement
const { client, pendingResponses } = await import('../../src/core/client.js');
const { channelService } = await import('../../src/services/channel/ChannelService.js');
const { handle } = await import('../../src/events/messageCreate.js');
const { bddService } = await import('../../src/services/bdd/BDDService.js');
const { fakeChannel, fakeMessage } = await import('../helpers/fakeDiscord.mjs');

// Channel par défaut des fakeMessage : 'chan-test' (helpers/fakeDiscord.mjs)
const CHANNEL_ID = 'chan-test';
const GUILD = 'guild-shop';

before(async () => {
    client.user = { id: 'bot-shop' };
    client.channels.cache.set(CHANNEL_ID, fakeChannel({ id: CHANNEL_ID }));
    await channelService.init(CHANNEL_ID);
    await bddService.init();
});

after(async () => {
    await bddService.close();
    await mongod.stop();
});

/**
 * Crée un dresseur et lance la commande !shop
 * @param {string} userId
 * @param {string} content - Contenu du message ("!shop pokeball3"...)
 * @returns {Promise<Object>} - Le faux message (replies dans .replies)
 */
async function commanderShop(userId, content) {
    await bddService.createNewUser(GUILD, userId, userId);
    const message = fakeMessage({ authorId: userId, guildId: GUILD, content });
    await handle(message);
    return message;
}

test('!shop <ball><nombre> : achat direct sans passer par la vitrine', async () => {
    const prix = gameConfig.balls.pokeball.price;
    const message = await commanderShop('u-shop-1', '!shop pokeball3');

    const doc = await bddService.getDresseur(GUILD, 'u-shop-1');
    assert.equal(doc.pokeball, 3, 'balls créditées');
    assert.equal(doc.argent, 500 - 3 * prix, 'prix débité');
    assert.equal(doc.ballsAchetees, 3, 'compteur de stats alimenté');
    assert.ok(message.replies.some((r) => String(r).includes(`Achat effectué : 3 Pokeballs pour ${3 * prix}$`)), 'résumé d\'achat');
    assert.ok(message.replies.some((r) => String(r).includes('Solde restant')), 'solde affiché');
    // Raccourci : pas de collector, pas de clé de réponse en attente
    assert.ok(!pendingResponses.has(`${CHANNEL_ID}:u-shop-1`), 'aucune réponse en attente');
});

test('!shop <ball> : quantité absente -> 1 ball, saisie insensible à la casse', async () => {
    const prix = gameConfig.balls.superball.price;
    const message = await commanderShop('u-shop-2', '!shop Superball');

    const doc = await bddService.getDresseur(GUILD, 'u-shop-2');
    assert.equal(doc.superball, 1, 'une seule ball achetée');
    assert.equal(doc.argent, 500 - prix, 'prix d\'une ball débité');
    assert.ok(message.replies.some((r) => String(r).includes('Achat effectué : 1 Superball')), 'quantité par défaut à 1');
});

test('!shop !<ball><nombre> : le "!" de la ball est toléré', async () => {
    const prix = gameConfig.balls.hyperball.price;
    const message = await commanderShop('u-shop-3', '!shop !hyperball2');

    const doc = await bddService.getDresseur(GUILD, 'u-shop-3');
    assert.equal(doc.hyperball, 2, 'balls créditées');
    assert.equal(doc.argent, 500 - 2 * prix, 'prix débité');
    assert.ok(message.replies.some((r) => String(r).includes('Achat effectué')), 'achat effectué');
});

test('!shop <type inconnu> : refusé sans rien consommer', async () => {
    const message = await commanderShop('u-shop-4', '!shop flute');

    const doc = await bddService.getDresseur(GUILD, 'u-shop-4');
    assert.equal(doc.argent, 500, 'rien débité');
    assert.equal(doc.ballsAchetees, 0, 'rien acheté');
    assert.ok(message.replies.some((r) => String(r).includes('pas en vente ici')), 'refus');
    assert.ok(message.replies.some((r) => String(r).includes('Pokeball')), 'balls en vente listées');
});

test('!shop <ball> : solde insuffisant refusé sans rien consommer', async () => {
    const prix = gameConfig.balls.maitreball.price;
    const message = await commanderShop('u-shop-5', '!shop maitreball2');

    const doc = await bddService.getDresseur(GUILD, 'u-shop-5');
    assert.equal(doc.maitreball, 0, 'rien crédité');
    assert.equal(doc.argent, 500, 'rien débité');
    assert.ok(message.replies.some((r) => String(r).includes('kopek')), 'refus solde insuffisant');
    assert.ok(2 * prix > 500, 'sanity : le test teste bien un solde insuffisant');
});
