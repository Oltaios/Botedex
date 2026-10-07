/**
 * Tests d'intégration des mini-jeux (GameService via la commande !game)
 * Fake Discord : messages, channel et collector factices. Base : MongoDB
 * en mémoire. L'appel Giphy (sendGif) est neutralisé : fetch échoue et le
 * service envoie son message d'erreur à la place du GIF.
 * Deux usages testés : "!game <type>" (lancement direct) et "!game" seul
 * suivi de "!<type>" (choix en différé).
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import '../helpers/env.mjs';
import { MongoMemoryServer } from 'mongodb-memory-server';

const mongod = await MongoMemoryServer.create();
process.env.MONGODB_URI = mongod.getUri();

// Imports dynamiques APRÈS l'environnement : BDDService fige l'URI à sa
// construction et client.js exige DISCORD_TOKEN au chargement
const { client, pendingResponses } = await import('../../src/core/client.js');
const { channelService } = await import('../../src/services/channel/ChannelService.js');
const { handle } = await import('../../src/events/messageCreate.js');
const { bddService } = await import('../../src/services/bdd/BDDService.js');
const { gameService } = await import('../../src/services/game/GameService.js');
const { fakeChannel, fakeCollector, fakeMessage } = await import('../helpers/fakeDiscord.mjs');

const CHANNEL_ID = 'chan-game';
const GUILD = 'guild-game';

/**
 * Crée un channel dont tous les collectors créés restent accessibles
 * (le choix du jeu en crée un, puis le jeu lui-même en crée un autre)
 * @returns {{channel: Object, collectors: Array<Object>}}
 */
function channelAvecCollectors() {
    const collectors = [];
    const channel = fakeChannel({
        id: CHANNEL_ID,
        collectorFactory: () => {
            const collector = fakeCollector();
            collectors.push(collector);
            return collector;
        }
    });
    return { channel, collectors };
}

/**
 * Simule l'envoi d'une commande par un dresseur via le routeur messageCreate
 * @returns {Promise<Object>} - Message factice avec ses replies dans .replies
 */
async function lancerCommande(userId, contenu, channel) {
    const message = fakeMessage({ authorId: userId, guildId: GUILD, channel, content: contenu });
    await handle(message);
    return message;
}

/**
 * Fige Math.random et retourne la fonction de restauration
 * (0 => numPkm = 1 : Bulbizarre, 6.9 kg, type plante/poison)
 */
function fixerRandom(valeur) {
    const original = Math.random;
    Math.random = () => valeur;
    return () => {
        Math.random = original;
    };
}

const fetchOriginale = globalThis.fetch;

before(async () => {
    client.user = { id: 'bot-game' };
    client.channels.cache.set(CHANNEL_ID, fakeChannel({ id: CHANNEL_ID }));
    await channelService.init(CHANNEL_ID);
    await bddService.init();
    // Pas de réseau dans les tests : sendGif récupère l'erreur et répond
    // son message d'échec à la place du GIF
    globalThis.fetch = async () => {
        throw new Error('réseau coupé (test)');
    };
});

after(async () => {
    globalThis.fetch = fetchOriginale;
    await bddService.close();
    await mongod.stop();
});

test('!game <type> lance directement le mini-jeu', async () => {
    await bddService.createNewUser(GUILD, 'ug1', 'joueur1');
    const { channel, collectors } = channelAvecCollectors();

    const message = await lancerCommande('ug1', '!game type', channel);

    assert.ok(message.replies.some((r) => String(r).includes('essais')), 'consigne du mini-jeu affichée');
    assert.equal(collectors.length, 1, 'collector d\'essais créé');
    assert.ok(pendingResponses.has(`${CHANNEL_ID}:ug1`), 'joueur marqué en attente de réponse');
});

test('trois essais ratés : échec, jeton consommé, clé libérée', async () => {
    await bddService.createNewUser(GUILD, 'ug2', 'joueur2');
    const { channel, collectors } = channelAvecCollectors();
    await lancerCommande('ug2', '!game type', channel);

    const reponses = [];
    for (let essai = 0; essai < 3; essai++) {
        const reponse = fakeMessage({ authorId: 'ug2', guildId: GUILD, channel, content: '!tartampion' });
        await collectors[0].emit('collect', reponse);
        reponses.push(reponse);
    }

    assert.ok(reponses[0].replies.some((r) => String(r).includes('essai')), 'premier essai compté');
    assert.ok(reponses[2].replies.some((r) => String(r).includes('The answer was')), 'révélation de la réponse à l\'échec');
    assert.equal(await gameService.isGameAvailable(GUILD, 'ug2', 'type'), false, 'jeton consommé dès la première réponse');
    assert.ok(!pendingResponses.has(`${CHANNEL_ID}:ug2`), 'clé libérée à la fin du jeu');
});

test('!game <type inconnu> : liste les jeux sans consommer le jeton', async () => {
    await bddService.createNewUser(GUILD, 'ug3', 'joueur3');
    const { channel } = channelAvecCollectors();

    const message = await lancerCommande('ug3', '!game devinetout', channel);

    assert.ok(message.replies.some((r) => String(r).includes('Je ne connais pas ce mini-jeu')));
    assert.ok(message.replies.some((r) => String(r).includes('**!type**')), 'jeux disponibles listés');
    assert.equal(await gameService.isGameAvailable(GUILD, 'ug3', 'type'), true, 'jeton intact');
});

test('!game weight : victoire dans la marge de tolérance (±10 %), récompense créditée', async () => {
    await bddService.createNewUser(GUILD, 'uw1', 'joueurw1');
    const { channel, collectors } = channelAvecCollectors();
    const restaurer = fixerRandom(0); // Bulbizarre, 6.9 kg (marge acceptée : 6.21 à 7.59)

    try {
        const message = await lancerCommande('uw1', '!game weight', channel);
        assert.ok(message.replies.some((r) => String(r).includes('poids')), 'consigne du mini-jeu affichée');
        assert.ok(message.replies.some((r) => String(r).includes('essais')), 'nombre d\'essais affiché');
        assert.ok(message.replies.some((r) => String(r).includes('±10 %')), 'marge de tolérance annoncée');

        const reponse = fakeMessage({ authorId: 'uw1', guildId: GUILD, channel, content: '!7' });
        await collectors[0].emit('collect', reponse);

        assert.ok(reponse.replies.some((r) => String(r).includes('You found it')), 'victoire dans la marge');
        assert.ok(reponse.replies.some((r) => String(r).includes('Le poids exact était 6.9 kg')), 'poids exact révélé');
        assert.equal(await gameService.isGameAvailable(GUILD, 'uw1', 'weight'), false, 'jeton consommé dès la première réponse');
        assert.equal(await bddService.getMoneyForUser(GUILD, 'uw1'), 580, 'récompense de 80 pokédollars créditée');
        assert.ok(!pendingResponses.has(`${CHANNEL_ID}:uw1`), 'clé libérée à la fin du jeu');
    } finally {
        restaurer();
    }
});

test('!game weight : indices plus lourd / plus léger puis échec au dernier essai', async () => {
    await bddService.createNewUser(GUILD, 'uw2', 'joueurw2');
    const { channel, collectors } = channelAvecCollectors();
    const restaurer = fixerRandom(0); // Bulbizarre, 6.9 kg (marge acceptée : 6.21 à 7.59)

    try {
        await lancerCommande('uw2', '!game weight', channel);

        // 6.0 kg : hors marge, juste en dessous
        const tropPetit = fakeMessage({ authorId: 'uw2', guildId: GUILD, channel, content: '!6' });
        await collectors[0].emit('collect', tropPetit);
        assert.ok(tropPetit.replies.some((r) => String(r).includes('plus lourd')), 'indice plus lourd');

        const tropLourd = fakeMessage({ authorId: 'uw2', guildId: GUILD, channel, content: '!999' });
        await collectors[0].emit('collect', tropLourd);
        assert.ok(tropLourd.replies.some((r) => String(r).includes('plus léger')), 'indice plus léger');

        const dernier = fakeMessage({ authorId: 'uw2', guildId: GUILD, channel, content: '!blabla' });
        await collectors[0].emit('collect', dernier);
        assert.ok(dernier.replies.some((r) => String(r).includes('The answer was !6.9 kg')), 'révélation du poids à l\'échec');
        assert.equal(await gameService.isGameAvailable(GUILD, 'uw2', 'weight'), false, 'jeton consommé dès la première réponse');
        assert.ok(!pendingResponses.has(`${CHANNEL_ID}:uw2`), 'clé libérée à la fin du jeu');
    } finally {
        restaurer();
    }
});

test('!game sans jeton disponible : refus', async () => {
    await bddService.createNewUser(GUILD, 'ug4', 'joueur4');
    await bddService.recordGamePlayed(GUILD, 'ug4', 'type', new Date());
    const { channel } = channelAvecCollectors();

    const message = await lancerCommande('ug4', '!game type', channel);

    assert.ok(message.replies.some((r) => String(r).includes('non disponible')));
});

test('!game seul : le choix "!type" en différé lance le mini-jeu', async () => {
    await bddService.createNewUser(GUILD, 'ug5', 'joueur5');
    const { channel, collectors } = channelAvecCollectors();

    const message = await lancerCommande('ug5', '!game', channel);
    assert.ok(message.replies.some((r) => String(r).includes('Quel mini-jeu')), 'question du choix affichée');
    const cleChoix = `game-choose:${CHANNEL_ID}:ug5`;
    assert.ok(pendingResponses.has(cleChoix), 'joueur marqué en attente du choix');

    const choix = fakeMessage({ authorId: 'ug5', guildId: GUILD, channel, content: '!type' });
    await collectors[0].emit('collect', choix);

    assert.ok(message.replies.some((r) => String(r).includes('essais')), 'mini-jeu lancé après le choix');
    assert.ok(!pendingResponses.has(cleChoix), 'clé de choix libérée');
    assert.ok(pendingResponses.has(`${CHANNEL_ID}:ug5`), 'clé du jeu posée');
    assert.equal(collectors.length, 2, 'collector du jeu créé après celui du choix');
});

test('!game seul : type inconnu refusé puis temps écoulé sans consommer le jeton', async () => {
    await bddService.createNewUser(GUILD, 'ug6', 'joueur6');
    const { channel, collectors } = channelAvecCollectors();

    const message = await lancerCommande('ug6', '!game', channel);

    const mauvais = fakeMessage({ authorId: 'ug6', guildId: GUILD, channel, content: '!blabla' });
    await collectors[0].emit('collect', mauvais);
    assert.ok(mauvais.replies.some((r) => String(r).includes('Je ne connais pas ce mini-jeu')), 'choix inconnu refusé sans lancer de jeu');

    // Fin du temps imparti du choix
    collectors[0].endReason = 'time';
    await collectors[0].emit('end');

    assert.ok(message.replies.some((r) => String(r).includes('Temps écoulé, aucun mini-jeu')), 'message de timeout');
    assert.ok(!pendingResponses.has(`game-choose:${CHANNEL_ID}:ug6`), 'clé libérée');
    assert.equal(await gameService.isGameAvailable(GUILD, 'ug6', 'type'), true, 'jeton intact, aucun jeu lancé');
});

test('jetons indépendants par jeu : jouer à type ne bloque pas weight', async () => {
    await bddService.createNewUser(GUILD, 'uj1', 'jeton1');
    await bddService.recordGamePlayed(GUILD, 'uj1', 'type', new Date());

    assert.equal(await gameService.isGameAvailable(GUILD, 'uj1', 'type'), false, 'type déjà joué cette heure');
    assert.equal(await gameService.isGameAvailable(GUILD, 'uj1', 'weight'), true, 'weight toujours disponible');
});

test('jeton horaire : un jeu joué à l\'heure précédente redevient disponible', async () => {
    await bddService.createNewUser(GUILD, 'uj2', 'jeton2');
    const heurePrecedente = new Date();
    heurePrecedente.setHours(heurePrecedente.getHours() - 1);
    await bddService.recordGamePlayed(GUILD, 'uj2', 'weight', heurePrecedente);

    assert.equal(await gameService.isGameAvailable(GUILD, 'uj2', 'weight'), true, 'heure précédente => disponible');
});

test('!game seul : seuls les jeux pas encore joués cette heure sont proposés', async () => {
    await bddService.createNewUser(GUILD, 'uj3', 'jeton3');
    await bddService.recordGamePlayed(GUILD, 'uj3', 'type', new Date());
    const { channel, collectors } = channelAvecCollectors();

    const message = await lancerCommande('uj3', '!game', channel);

    const question = String(message.replies.find((r) => String(r).includes('Quel mini-jeu')));
    assert.ok(question.includes('**!weight**'), 'weight proposé');
    assert.ok(!question.includes('**!type**'), 'type déjà joué, non proposé');
});

test('!game seul : aucun jeu disponible cette heure', async () => {
    await bddService.createNewUser(GUILD, 'uj4', 'jeton4');
    await bddService.recordGamePlayed(GUILD, 'uj4', 'type', new Date());
    await bddService.recordGamePlayed(GUILD, 'uj4', 'weight', new Date());
    const { channel } = channelAvecCollectors();

    const message = await lancerCommande('uj4', '!game', channel);

    assert.ok(message.replies.some((r) => String(r).includes('non disponible')), 'refus global');
});
