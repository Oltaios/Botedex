/**
 * Tests d'intégration de la commande !admin :
 * - permission par liste d'IDs (ADMIN_USER_IDS, qui prime sur la config)
 * - !admin stopWork : arrêt de tous les travailleurs du serveur, paye au
 *   prorata du temps travaillé, isolation par guild, annulation des fins
 *   de session planifiées (sinon le process de test resterait vivant 1 h)
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import '../helpers/env.mjs';
import { MongoMemoryServer } from 'mongodb-memory-server';

// Admins de ce processus de test (lu à chaque appel par getAdminUserIds)
process.env.ADMIN_USER_IDS = 'admin-boss, admin-2';

const mongod = await MongoMemoryServer.create();
process.env.MONGODB_URI = mongod.getUri();

// Imports dynamiques APRÈS l'environnement : BDDService fige l'URI à sa
// construction et client.js exige DISCORD_TOKEN au chargement
const { client } = await import('../../src/core/client.js');
const { channelService } = await import('../../src/services/channel/ChannelService.js');
const { handle } = await import('../../src/events/messageCreate.js');
const { bddService } = await import('../../src/services/bdd/BDDService.js');
const { workService } = await import('../../src/services/economy/WorkService.js');
const { fakeChannel, fakeMessage } = await import('../helpers/fakeDiscord.mjs');

// Channel par défaut des fakeMessage : 'chan-test' (helpers/fakeDiscord.mjs)
const CHANNEL_ID = 'chan-test';
const BOT_ID = 'bot-123';
const GUILD = 'guild-admin';
const GUILD_AUTRE = 'guild-autre';

before(async () => {
    client.user = { id: BOT_ID };
    client.channels.cache.set(CHANNEL_ID, fakeChannel({ id: CHANNEL_ID }));
    await channelService.init(CHANNEL_ID);
    await bddService.init();
});

after(async () => {
    await bddService.close();
    await mongod.stop();
});

/**
 * Simule un départ au travail "à la main" : isWorking = 1 + heure de début
 * contrôlée, sans passer par workService.startWork (pas de timer planifié)
 * @param {string} guildId
 * @param {string} userId
 * @param {number|null} workStartTime - Timestamp ms, ou null (ancien dresseur)
 */
async function faireTravailler(guildId, userId, workStartTime) {
    await bddService.createNewUser(guildId, userId, userId);
    await bddService.updateOneFieldForOneUser(guildId, userId, 'isWorking', 1);
    await bddService.updateOneFieldForOneUser(guildId, userId, 'workStartTime', workStartTime);
}

test('!admin : refus pour un non-admin, sans libérer les travailleurs', async () => {
    await faireTravailler(GUILD, 'u-refus', Date.now() - 15 * 60 * 1000);

    const message = fakeMessage({ authorId: 'u-lambda', guildId: GUILD, content: '!admin stopWork' });
    await handle(message);
    assert.ok(message.replies.some((r) => String(r).includes('réservée aux admins')), 'refus');

    const doc = await bddService.getDresseur(GUILD, 'u-refus');
    assert.equal(doc.isWorking, 1, 'toujours au travail');
    assert.equal(doc.argent, 500, 'pas de paye');
});

test('!admin stopWork : paie au prorata et libère tous les travailleurs du serveur', async () => {
    // u-prorata : vraie session (timer planifié, que stopAllWork doit annuler)
    // démarrée il y a 30 min (moitié de la durée d'une session)
    const messageWork = fakeMessage({ authorId: 'u-prorata', guildId: GUILD, content: '!work' });
    await bddService.createNewUser(GUILD, 'u-prorata', 'prorata');
    assert.equal(await workService.startWork(GUILD, 'u-prorata', messageWork), true);
    await bddService.updateOneFieldForOneUser(GUILD, 'u-prorata', 'workStartTime', Date.now() - 30 * 60 * 1000);

    // u-ancien : isWorking = 1 sans workStartTime (prorata impossible)
    await faireTravailler(GUILD, 'u-ancien', null);

    // u-oisif : pas au travail, ne doit rien recevoir
    await bddService.createNewUser(GUILD, 'u-oisif', 'oisif');

    // u-ailleurs : au travail sur un AUTRE serveur, ne doit pas être touché
    await faireTravailler(GUILD_AUTRE, 'u-ailleurs', Date.now() - 30 * 60 * 1000);

    // L'admin n'est PAS un dresseur enregistré : la permission vient de la
    // liste d'IDs de la config, le routage doit passer avant l'enregistrement
    const message = fakeMessage({ authorId: 'admin-boss', guildId: GUILD, content: '!admin stopWork' });
    await handle(message);
    assert.ok(message.replies.some((r) => String(r).includes('renvoyé')), 'résumé des renvois');

    const reward = workService.getWorkReward();
    const prorata = await bddService.getDresseur(GUILD, 'u-prorata');
    assert.equal(prorata.isWorking, 0, 'libéré');
    assert.equal(prorata.argent, 500 + Math.round(reward / 2), 'moitié de la paye');

    const ancien = await bddService.getDresseur(GUILD, 'u-ancien');
    assert.equal(ancien.isWorking, 0, 'libéré même sans workStartTime');
    assert.equal(ancien.argent, 500, 'pas de paye sans durée connue');

    const oisif = await bddService.getDresseur(GUILD, 'u-oisif');
    assert.equal(oisif.isWorking, 0, 'n\'était pas au travail');
    assert.equal(oisif.argent, 500, 'rien reçu');

    const ailleurs = await bddService.getDresseur(GUILD_AUTRE, 'u-ailleurs');
    assert.equal(ailleurs.isWorking, 1, 'autre guild non touchée');
    assert.equal(ailleurs.argent, 500, 'autre guild non payée');
});

test('!admin stats : totaux du serveur et top joueurs', async () => {
    // Guild dédiée : totaux déterministes, non pollués par les tests précédents
    const GUILD_STATS = 'guild-stats';
    await bddService.createNewUser(GUILD_STATS, 'u-stats-1', 'stats-un');
    await bddService.createNewUser(GUILD_STATS, 'u-stats-2', 'stats-deux');
    await bddService.gainMoney(GUILD_STATS, 'u-stats-1', 100);
    await bddService.purchaseBalls(GUILD_STATS, 'u-stats-1', 'pokeball', 4, 80);
    await bddService.settleCasinoBet(GUILD_STATS, 'u-stats-2', 30, -30);
    await bddService.incrementerEchecCapture(GUILD_STATS, 'u-stats-2');

    const message = fakeMessage({ authorId: 'admin-boss', guildId: GUILD_STATS, content: '!admin stats' });
    await handle(message);
    const reply = String(message.replies[message.replies.length - 1] ?? '');

    assert.ok(reply.includes('2 joueur(s)'), 'nombre de joueurs');
    assert.ok(reply.includes('Argent accumulé (gains bruts) : 100$'), 'argent accumulé');
    assert.ok(reply.includes('Balls achetées : 4'), 'balls achetées');
    assert.ok(reply.includes('Échecs de capture : 1'), 'échecs de capture');
    assert.ok(reply.includes('Argent misé au casino : 30$'), 'argent misé');
    assert.ok(reply.includes('Argent en circulation : 990$'), 'somme des soldes');
    assert.ok(reply.includes('stats-un — 100$ gagnés, 4 balls achetées, 0 échec(s), 0$ misés'), 'top 1 détaillé');
    assert.ok(reply.indexOf('stats-un') < reply.indexOf('stats-deux'), 'classé par argent accumulé');

    // Refus pour un non-admin, sans divulguer les stats
    const refus = fakeMessage({ authorId: 'u-lambda', guildId: GUILD_STATS, content: '!admin stats' });
    await handle(refus);
    assert.ok(refus.replies.some((r) => String(r).includes('réservée aux admins')), 'refus non-admin');
});

test('!admin stopWork sans travailleur : chantier désert', async () => {
    const message = fakeMessage({ authorId: 'admin-boss', guildId: GUILD, content: '!admin stopWork' });
    await handle(message);
    assert.ok(message.replies.some((r) => String(r).includes('désert')));
});

test('!admin sans action : liste des actions', async () => {
    const message = fakeMessage({ authorId: 'admin-boss', guildId: GUILD, content: '!admin' });
    await handle(message);
    assert.ok(message.replies.some((r) => String(r).includes('stopWork')));
});

test('!admin action inconnue', async () => {
    const message = fakeMessage({ authorId: 'admin-boss', guildId: GUILD, content: '!admin flute' });
    await handle(message);
    assert.ok(message.replies.some((r) => String(r).includes('Action admin inconnue')));
});
