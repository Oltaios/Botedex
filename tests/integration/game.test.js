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
const { getConfig } = await import('../../src/utils/configLoader.js');
const REWARD_ABILITY = getConfig().game.guessMyAbilityReward; // lu depuis la config (pas en dur)
const REWARD_NAME = getConfig().game.guessMyNameReward;
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

test('!game poids : victoire dans la marge de tolérance (±10 %), récompense créditée', async () => {
    await bddService.createNewUser(GUILD, 'uw1', 'joueurw1');
    const { channel, collectors } = channelAvecCollectors();
    const restaurer = fixerRandom(0); // Bulbizarre, 6.9 kg (marge acceptée : 6.21 à 7.59)

    try {
        const message = await lancerCommande('uw1', '!game poids', channel);
        assert.ok(message.replies.some((r) => String(r).includes('poids')), 'consigne du mini-jeu affichée');
        assert.ok(message.replies.some((r) => String(r).includes('essais')), 'nombre d\'essais affiché');
        assert.ok(message.replies.some((r) => String(r).includes('±10 %')), 'marge de tolérance annoncée');

        const reponse = fakeMessage({ authorId: 'uw1', guildId: GUILD, channel, content: '!7' });
        await collectors[0].emit('collect', reponse);

        assert.ok(reponse.replies.some((r) => String(r).includes('You found it')), 'victoire dans la marge');
        assert.ok(reponse.replies.some((r) => String(r).includes('Le poids exact était 6.9 kg')), 'poids exact révélé');
        assert.equal(await gameService.isGameAvailable(GUILD, 'uw1', 'poids'), false, 'jeton consommé dès la première réponse');
        assert.equal(await bddService.getMoneyForUser(GUILD, 'uw1'), 580, 'récompense de 80 pokédollars créditée');
        assert.ok(!pendingResponses.has(`${CHANNEL_ID}:uw1`), 'clé libérée à la fin du jeu');
    } finally {
        restaurer();
    }
});

test('!game poids : indices plus lourd / plus léger puis échec au dernier essai', async () => {
    await bddService.createNewUser(GUILD, 'uw2', 'joueurw2');
    const { channel, collectors } = channelAvecCollectors();
    const restaurer = fixerRandom(0); // Bulbizarre, 6.9 kg (marge acceptée : 6.21 à 7.59)

    try {
        await lancerCommande('uw2', '!game poids', channel);

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
        assert.equal(await gameService.isGameAvailable(GUILD, 'uw2', 'poids'), false, 'jeton consommé dès la première réponse');
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
    assert.equal(await gameService.isGameAvailable(GUILD, 'uj1', 'poids'), true, 'poids toujours disponible');
});

test('jeton horaire : un jeu joué à l\'heure précédente redevient disponible', async () => {
    await bddService.createNewUser(GUILD, 'uj2', 'jeton2');
    const heurePrecedente = new Date();
    heurePrecedente.setHours(heurePrecedente.getHours() - 1);
    await bddService.recordGamePlayed(GUILD, 'uj2', 'poids', heurePrecedente);

    assert.equal(await gameService.isGameAvailable(GUILD, 'uj2', 'poids'), true, 'heure précédente => disponible');
});

test('!game seul : seuls les jeux pas encore joués cette heure sont proposés', async () => {
    await bddService.createNewUser(GUILD, 'uj3', 'jeton3');
    await bddService.recordGamePlayed(GUILD, 'uj3', 'type', new Date());
    const { channel, collectors } = channelAvecCollectors();

    const message = await lancerCommande('uj3', '!game', channel);

    const question = String(message.replies.find((r) => String(r).includes('Quel mini-jeu')));
    assert.ok(question.includes('**!poids**'), 'poids proposé');
    assert.ok(!question.includes('**!type**'), 'type déjà joué, non proposé');
});

test('!game seul : aucun jeu disponible cette heure', async () => {
    await bddService.createNewUser(GUILD, 'uj4', 'jeton4');
    await bddService.recordGamePlayed(GUILD, 'uj4', 'type', new Date());
    await bddService.recordGamePlayed(GUILD, 'uj4', 'poids', new Date());
    await bddService.recordGamePlayed(GUILD, 'uj4', 'nom', new Date());
    await bddService.recordGamePlayed(GUILD, 'uj4', 'talent', new Date());
    const { channel } = channelAvecCollectors();

    const message = await lancerCommande('uj4', '!game', channel);

    assert.ok(message.replies.some((r) => String(r).includes('non disponible')), 'refus global');
});

test('!game nom : lance le pendu, voyelle offerte révélée, lettres masquées', async () => {
    await bddService.createNewUser(GUILD, 'un1', 'pendu1');
    const { channel, collectors } = channelAvecCollectors();
    const restaurer = fixerRandom(0); // numPkm = 1 (Bulbizarre), voyelle offerte = 1ère présente (u)
    let message;
    try {
        message = await lancerCommande('un1', '!game nom', channel);
    } finally {
        restaurer();
    }
    assert.equal(collectors.length, 1, 'collector de lettres créé');
    const consigne = message.replies.find((r) => String(r).includes('Pendu'));
    assert.ok(consigne, 'consigne pendu affichée');
    assert.ok(/\*/.test(String(consigne)) && /\bU\b/.test(String(consigne)), 'voyelle offerte révélée (U), le reste masqué (*) : ' + consigne);
    assert.ok(String(consigne).includes(REWARD_NAME + '$'), 'récompense affichée (config guessMyNameReward)');
});

test('!game nom : trouver le nom complet rapporte 50$ (guessMyNameReward)', async () => {
    await bddService.createNewUser(GUILD, 'un2', 'pendu2');
    const { channel, collectors } = channelAvecCollectors();
    const restaurer = fixerRandom(0); // Bulbizarre
    let message;
    try {
        message = await lancerCommande('un2', '!game nom', channel);
    } finally {
        restaurer();
    }
    // lettres de 'bulbizarre' : b,u,l,i,z,a,r,e — 'u' déjà offerte au départ
    const reponses = [];
    for (const l of ['b', 'l', 'i', 'z', 'a', 'r', 'e']) {
        const rep = fakeMessage({ authorId: 'un2', guildId: GUILD, channel, content: '!' + l });
        await collectors[0].emit('collect', rep);
        reponses.push(rep);
    }
    const win = reponses.at(-1).replies.find((r) => String(r).includes('Bravo'));
    assert.ok(win, 'message de victoire : ' + JSON.stringify(reponses.at(-1).replies));
    assert.ok(String(win).includes('Bulbizarre'), 'nom révélé dans le message de victoire');
    assert.equal((await bddService.getDresseur(GUILD, 'un2')).argent, 550, '50$ crédités (500 + guessMyNameReward)');
    assert.equal(await gameService.isGameAvailable(GUILD, 'un2', 'nom'), false, 'jeton consommé dès la 1re réponse');
});

test('!game nom : 3e erreur = défaite sans gain, réponse révélée', async () => {
    await bddService.createNewUser(GUILD, 'un3', 'pendu3');
    const { channel, collectors } = channelAvecCollectors();
    const restaurer = fixerRandom(0); // Bulbizarre
    try {
        await lancerCommande('un3', '!game nom', channel);
    } finally {
        restaurer();
    }
    const reponses = [];
    for (const l of ['x', 'y', 'w']) { // 3 lettres absentes de 'bulbizarre'
        const rep = fakeMessage({ authorId: 'un3', guildId: GUILD, channel, content: '!' + l });
        await collectors[0].emit('collect', rep);
        reponses.push(rep);
    }
    const lose = reponses[2].replies.find((r) => String(r).includes('perdu'));
    assert.ok(lose, 'message de défaite à la 3e erreur');
    assert.ok(String(lose).includes('Bulbizarre'), 'réponse révélée après défaite');
    assert.equal((await bddService.getDresseur(GUILD, 'un3')).argent, 500, 'aucun gain à la défaite');
});

test('!game talent : 4 options + 4 réactions posées, bonne réponse rapporte la récompense config', async () => {
    await bddService.createNewUser(GUILD, 'ua1', 'quiz1');
    const { channel } = channelAvecCollectors();
    const restaurer = fixerRandom(0); // numPkm = 1 (Bulbizarre), bonne capacité = Overgrow (1ère)
    let message;
    try {
        message = await lancerCommande('ua1', '!game talent', channel);
    } finally {
        restaurer();
    }
    const session = gameService.sessionsAbilites.get(message.id);
    assert.ok(session, 'session de quiz créée (indexée par le message)');
    assert.equal(session.options.length, 4, '4 capacités proposées');
    assert.ok(session.options.includes('Engrais'), 'la capacité du Pokémon (Bulbizarre) est dans les options, en français (CSV traduit)');
    const quiz = message.replies.find((r) => String(r).includes('capacité de'));
    assert.ok(quiz && String(quiz).includes('Engrais'), 'options affichées en français (Engrais)');
    assert.equal(message.reactions.length, 4, '4 réactions emoji posées par le bot');
    assert.deepEqual(message.reactions, ['1️⃣', '2️⃣', '3️⃣', '4️⃣']);

    const emojis = ['1️⃣', '2️⃣', '3️⃣', '4️⃣'];
    const bonEmoji = emojis[session.bonneIndex];
    await gameService.handleReaction({ emoji: { name: bonEmoji }, message: { id: message.id } }, { id: 'ua1', bot: false });

    assert.equal((await bddService.getDresseur(GUILD, 'ua1')).argent, 500 + REWARD_ABILITY, 'récompense créditée (guessMyAbilityReward, config)');
    assert.equal(await gameService.isGameAvailable(GUILD, 'ua1', 'talent'), false, 'jeton consommé au 1er clic');
    assert.equal(gameService.sessionsAbilites.get(message.id), undefined, 'session nettoyée après réponse');
    assert.ok(!pendingResponses.has(`${CHANNEL_ID}:ua1`), 'clé de réponse libérée');
    const mainChannel = client.channels.cache.get(CHANNEL_ID);
    const win = mainChannel.sent.find((m) => String(m).includes('Bravo'));
    assert.ok(win && String(win).includes('Engrais'), 'victoire annoncée avec la bonne capacité (en français)');
});

test('!game talent : mauvaise réponse = aucun gain, bonne capacité révélée', async () => {
    await bddService.createNewUser(GUILD, 'ua2', 'quiz2');
    const { channel } = channelAvecCollectors();
    const restaurer = fixerRandom(0); // Bulbizarre / Overgrow
    let message;
    try {
        message = await lancerCommande('ua2', '!game talent', channel);
    } finally {
        restaurer();
    }
    const session = gameService.sessionsAbilites.get(message.id);
    const mauvaisIndex = (session.bonneIndex + 1) % 4;
    await gameService.handleReaction({ emoji: { name: ['1️⃣','2️⃣','3️⃣','4️⃣'][mauvaisIndex] }, message: { id: message.id } }, { id: 'ua2', bot: false });
    assert.equal((await bddService.getDresseur(GUILD, 'ua2')).argent, 500, 'aucun gain');
    const mainChannel = client.channels.cache.get(CHANNEL_ID);
    const lose = mainChannel.sent.find((m) => String(m).includes('Raté'));
    assert.ok(lose && String(lose).includes('Engrais'), 'bonne capacité révélée en français après échec');
});

test('!game talent : la réaction d\'un autre joueur est ignorée', async () => {
    await bddService.createNewUser(GUILD, 'ua3', 'quiz3');
    await bddService.createNewUser(GUILD, 'ua4', 'intrus');
    const { channel } = channelAvecCollectors();
    const restaurer = fixerRandom(0);
    let message;
    try {
        message = await lancerCommande('ua3', '!game talent', channel);
    } finally {
        restaurer();
    }
    const session = gameService.sessionsAbilites.get(message.id);
    await gameService.handleReaction({ emoji: { name: '1️⃣' }, message: { id: message.id } }, { id: 'ua4', bot: false });
    assert.equal(session.repondu, false, 'pas de réponse enregistrée pour un autre joueur');
    assert.equal((await bddService.getDresseur(GUILD, 'ua4')).argent, 500, 'aucun gain pour l\'intrus');
    assert.equal(await gameService.isGameAvailable(GUILD, 'ua3', 'talent'), true, 'jeton du joueur non consommé');
});

test('e2e alias : !game weight (ancien nom) lance le jeu poids sous la clé française', async () => {
    await bddService.createNewUser(GUILD, 'ua9', 'alias');
    const { channel } = channelAvecCollectors();
    const message = await lancerCommande('ua9', '!game weight', channel);
    assert.ok(message.replies.some((r) => String(r).includes('poids')), 'jeu de poids lancé via l\'alias anglais');
    assert.equal(await gameService.isGameAvailable(GUILD, 'ua9', 'poids'), true, 'jeton sous la nouvelle clé FR');
    assert.equal(await gameService.isGameAvailable(GUILD, 'ua9', 'weight'), true, 'pas de jeton sous l\'ancienne clé');
});
