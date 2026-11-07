/**
 * Tests d'intégration de l'événement quotidien collaboratif (DailyEventService)
 * Fake Discord + MongoDB en mémoire. L'event est réactivé ici ('on') car
 * tests/helpers/env.mjs le désactive par défaut pour les autres tests.
 *
 * Scénarios : accumulation de points (capture/jeu/travail), marquage actif,
 * objectif scalable (100 pts × joueurs actifs), complétion (200$ aux actifs
 * uniquement + message réduit par joueur : ses points, le gain, le reset),
 * reset (points à 0, isActive recalculé 24h), statut !event avec barre.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import '../helpers/env.mjs';
process.env.BOTEDEX_DAILY_EVENT = 'on'; // env.mjs le met à 'off' par défaut
import { MongoMemoryServer } from 'mongodb-memory-server';

const mongod = await MongoMemoryServer.create();
process.env.MONGODB_URI = mongod.getUri();

const { client } = await import('../../src/core/client.js');
const { channelService } = await import('../../src/services/channel/ChannelService.js');
const { bddService } = await import('../../src/services/bdd/BDDService.js');
const { dailyEventService } = await import('../../src/services/event/DailyEventService.js');
const { fakeChannel, fakeMessage } = await import('../helpers/fakeDiscord.mjs');

const CHANNEL_ID = 'chan-event';
let channel;

before(async () => {
    client.user = { id: 'bot-event' };
    channel = fakeChannel({ id: CHANNEL_ID });
    client.channels.cache.set(CHANNEL_ID, channel);
    await channelService.init(CHANNEL_ID);
    await bddService.init();
    await bddService.ensureActivityFields();
});

after(async () => {
    dailyEventService.stop();
    await bddService.close();
    await mongod.stop();
});

test('registerActivity : points au dresseur, total event, isActive, goal = 100 × actifs', async () => {
    const G = 'g-event-1';
    await bddService.createNewUser(G, 'u1', 'Alice');
    await dailyEventService.registerActivity(G, 'u1', 'capture'); // 10 pts
    await dailyEventService.registerActivity(G, 'u1', 'game');    // 5 pts
    await dailyEventService.registerActivity(G, 'u1', 'work');    // 5 pts

    const doc = await bddService.getDresseur(G, 'u1');
    assert.equal(doc.activityPoints, 20, '10 + 5 + 5 points');
    assert.equal(doc.isActive, 1, 'marqué actif');
    assert.ok(doc.lastCommandAt instanceof Date, 'lastCommandAt enregistré');

    const ev = await bddService.getDailyEvent(G);
    assert.equal(ev.totalPoints, 20, "total de l'event incrémenté");
    assert.equal(ev.goal, 100, 'goal = 100 pts × 1 joueur actif');
    assert.equal(ev.completed, false);
    assert.equal(ev.dateKey, dailyEventService.dateKey());
});

test('complétion : 100 pts avec 1 actif -> 200$ pour l\'actif, message réduit (points, gain, reset)', async () => {
    const G = 'g-event-2';
    await bddService.createNewUser(G, 'u2', 'Bob');
    for (let i = 0; i < 10; i++) {
        await dailyEventService.registerActivity(G, 'u2', 'capture'); // 10 × 10 = 100 pts
    }

    const doc = await bddService.getDresseur(G, 'u2');
    assert.equal(doc.activityPoints, 100);
    assert.equal(doc.argent, 500 + 200, 'récompense de 200$ versée à la complétion');

    const ev = await bddService.getDailyEvent(G);
    assert.equal(ev.completed, true, 'event marqué terminé');
    assert.equal(ev.rewardPaid, 200);
    assert.equal(ev.totalPoints, 100);

    const annonce = channel.sent.find((m) => String(m).includes('Événement terminé'));
    assert.ok(annonce, 'message de complétion envoyé : ' + JSON.stringify(channel.sent));
    assert.ok(String(annonce).includes('<@u2>'), 'ping du joueur');
    assert.ok(String(annonce).includes('100 pts'), 'ses points uniquement');
    assert.ok(String(annonce).includes('+200$'), 'gain indiqué');
    assert.ok(String(annonce).includes('2h00'), 'heure du reset indiquée');
    assert.ok(!String(annonce).includes('100/100'), 'plus de progression globale dans le message');
});

test('complétion : les joueurs inactifs ne reçoivent aucune récompense', async () => {
    const G = 'g-event-3';
    await bddService.createNewUser(G, 'u3', 'Chuck');
    await dailyEventService.registerActivity(G, 'u3', 'work'); // 5 pts, actif à ce moment
    // Chuck devient inactif : dernière commande il y a 48h
    await bddService.updateOneFieldForOneUser(G, 'u3', 'lastCommandAt', new Date(Date.now() - 48 * 3600 * 1000));
    await bddService.updateOneFieldForOneUser(G, 'u3', 'isActive', 0);

    await bddService.createNewUser(G, 'u4', 'Dana');
    for (let i = 0; i < 10; i++) {
        await dailyEventService.registerActivity(G, 'u4', 'capture'); // 100 pts, 1 seul actif -> goal 100
    }

    assert.equal((await bddService.getDresseur(G, 'u4')).argent, 700, 'actif récompensé');
    assert.equal((await bddService.getDresseur(G, 'u3')).argent, 500, 'inactif non récompensé');

    const ev = await bddService.getDailyEvent(G);
    assert.equal(ev.completed, true);
    assert.equal(ev.goal, 100, 'goal calculé sur les actifs uniquement (u4)');
    const annonces = channel.sent.filter((m) => String(m).includes('Événement terminé'));
    assert.ok(!annonces.some((m) => String(m).includes('<@u3>')), "pas de message pour l'inactif");
    assert.ok(annonces.some((m) => String(m).includes('<@u4>')), "message pour l'actif");
});

test('performReset : points à 0 pour tous, isActive recalculé sur 24h, event réinitialisé', async () => {
    const G = 'g-event-4';
    await bddService.createNewUser(G, 'u5', 'Eve');
    await dailyEventService.registerActivity(G, 'u5', 'capture'); // 10 pts, actif
    // Eve : dernière commande il y a 48h -> inactif après reset
    await bddService.updateOneFieldForOneUser(G, 'u5', 'lastCommandAt', new Date(Date.now() - 48 * 3600 * 1000));

    await bddService.createNewUser(G, 'u6', 'Fred');
    await dailyEventService.registerActivity(G, 'u6', 'work'); // commande récente -> reste actif

    await dailyEventService.performReset();

    assert.equal((await bddService.getDresseur(G, 'u5')).activityPoints, 0, 'points reset');
    assert.equal((await bddService.getDresseur(G, 'u5')).isActive, 0, 'inactif : commande > 24h');
    assert.equal((await bddService.getDresseur(G, 'u6')).isActive, 1, 'actif : commande < 24h');

    const ev = await bddService.getDailyEvent(G);
    assert.equal(ev.totalPoints, 0, 'total event reset');
    assert.equal(ev.completed, false, 'event réinitialisé');
    assert.equal(ev.dateKey, dailyEventService.dateKey(), 'dateKey du jour');
});

test('getStatus : progression, goal, points perso et barre pour !event', async () => {
    const G = 'g-event-5';
    await bddService.createNewUser(G, 'u7', 'Gaby');
    await dailyEventService.registerActivity(G, 'u7', 'capture');
    await dailyEventService.registerActivity(G, 'u7', 'capture'); // 20 pts

    const s = await dailyEventService.getStatus(G, 'u7');
    assert.equal(s.totalPoints, 20);
    assert.equal(s.goal, 100);
    assert.equal(s.myPoints, 20);
    assert.equal(s.activeCount, 1);
    assert.equal(s.isActive, true);
    assert.equal(s.completed, false);
    assert.equal(s.bar, '[██░░░░░░░░]', 'barre de progression 20%');
    assert.ok(s.nextReset instanceof Date);
});

test('l\'event terminé ne se déclenche qu\'une fois (idempotent)', async () => {
    const G = 'g-event-6';
    await bddService.createNewUser(G, 'u8', 'Hugo');
    for (let i = 0; i < 12; i++) {
        await dailyEventService.registerActivity(G, 'u8', 'capture'); // 120 pts > goal 100
    }
    assert.equal((await bddService.getDresseur(G, 'u8')).argent, 700, 'une seule récompense de 200$');
    const annonces = channel.sent.filter((m) => String(m).includes('Événement terminé') && String(m).includes('<@u8>'));
    assert.equal(annonces.length, 1, 'un seul message de complétion pour le joueur');
});

test('chemin différé (!game puis !<type>) : les points d\'activité sont aussi enregistrés', async () => {
    const { gameService } = await import('../../src/services/game/GameService.js');
    const { fakeCollector } = await import('../helpers/fakeDiscord.mjs');
    const G = 'g-event-7';
    await bddService.createNewUser(G, 'u9', 'Ivan');

    const collectors = [];
    const chan = fakeChannel({
        id: 'chan-event-deferred',
        collectorFactory: () => { const c = fakeCollector(); collectors.push(c); return c; }
    });
    const message = fakeMessage({ authorId: 'u9', guildId: G, channel: chan, content: '!game' });
    await gameService.startGame(message, null); // "!game" seul -> choix en différé
    assert.equal(collectors.length, 1, 'collector de choix créé');

    const choix = fakeMessage({ authorId: 'u9', guildId: G, channel: chan, content: '!type' });
    await collectors[0].emit('collect', choix); // le dresseur choisit "!type"

    const doc = await bddService.getDresseur(G, 'u9');
    assert.equal(doc.activityPoints, 5, '5 points de jeu enregistrés via le choix différé');
    const ev = await bddService.getDailyEvent(G);
    assert.equal(ev.totalPoints, 5, "total de l'event incrémenté aussi sur ce chemin");
});
