/**
 * Tests d'intégration de BDDService sur un vrai MongoDB en mémoire
 * (mongodb-memory-server). Priorités de non-régression : clé composite
 * _id = { guildId, userId }, isolation par serveur, opérations atomiques,
 * resets limités à la guild passée.
 *
 * Le singleton BDDService fige MONGODB_URI à sa construction : le serveur
 * mémoire doit démarrer AVANT tout import du code applicatif (import
 * dynamique après MongoMemoryServer.create()).
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import '../helpers/env.mjs';
import { MongoMemoryServer } from 'mongodb-memory-server';
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

const mongod = await MongoMemoryServer.create();
process.env.MONGODB_URI = mongod.getUri();

const { bddService } = await import('../../src/services/bdd/BDDService.js');
const { casinoService } = await import('../../src/services/economy/CasinoService.js');

before(async () => {
    await bddService.init();
});

after(async () => {
    await bddService.close();
    await mongod.stop();
});

test('createNewUser : _id composite { guildId, userId } dans cet ordre', async () => {
    await bddService.createNewUser('gA', 'uA', 'toto');
    const doc = await bddService.getDresseur('gA', 'uA');
    assert.ok(doc, 'dresseur créé');
    // Ordre des champs critique : une égalité sur un sous-document _id ne
    // matche que si l'ordre est identique (cf. #dresseurId)
    assert.deepEqual(Object.keys(doc._id), ['guildId', 'userId']);
    assert.equal(doc._id.guildId, 'gA');
    assert.equal(doc._id.userId, 'uA');
    assert.equal(doc.name, 'toto');
    assert.equal(doc.argent, 500);
    // Compteurs de statistiques initialisés à 0
    assert.equal(doc.argentGagne, 0);
    assert.equal(doc.ballsAchetees, 0);
    assert.equal(doc.capturesEchouees, 0);
    assert.equal(doc.argentMise, 0);
    assert.equal(doc.gameTokens, undefined, 'jetons de jeu créés à la première réponse');
    assert.deepEqual(
        await bddService.getBallsForUser('gA', 'uA'),
        stocks({})
    );
});

test('isolation par serveur : un même dresseur a un document par guild', async () => {
    await bddService.createNewUser('g1', 'u1', 'j1');
    await bddService.createNewUser('g2', 'u1', 'j1');
    await bddService.gainMoney('g1', 'u1', 100);

    assert.equal(await bddService.getMoneyForUser('g1', 'u1'), 600);
    assert.equal(await bddService.getMoneyForUser('g2', 'u1'), 500);
    // Statistique argentGagne : alimentée uniquement sur le serveur du gain
    assert.equal((await bddService.getDresseur('g1', 'u1')).argentGagne, 100);
    assert.equal((await bddService.getDresseur('g2', 'u1')).argentGagne, 0);

    // L'ordre des champs inversé ne doit RIEN matcher : c'est le contrat
    // qui garantit que #dresseurId est utilisé partout
    const direct = await bddService.db
        .collection('dresseurs')
        .findOne({ _id: { userId: 'u1', guildId: 'g1' } });
    assert.equal(direct, null);
});

test('validerRegleGestionUtilisateurEnregistre : false puis true', async () => {
    assert.equal(await bddService.validerRegleGestionUtilisateurEnregistre('g3', 'u3'), false);
    await bddService.createNewUser('g3', 'u3', 'j3');
    assert.equal(await bddService.validerRegleGestionUtilisateurEnregistre('g3', 'u3'), true);
});

test('tryToLoseBall : refuse à stock 0, décrémente sinon', async () => {
    await bddService.createNewUser('g4', 'u4', 'j4');
    assert.equal(await bddService.tryToLoseBall('g4', 'u4', 'pokeball'), 1);
    await bddService.updateOneFieldForOneUser('g4', 'u4', 'pokeball', 2);
    assert.equal(await bddService.tryToLoseBall('g4', 'u4', 'pokeball'), 0);
    assert.deepEqual(await bddService.getBallsForUser('g4', 'u4'), stocks({ pokeball: 1 }));
});

test('purchaseBalls : atomique, refuse si solde insuffisant', async () => {
    await bddService.createNewUser('g5', 'u5', 'j5'); // 500$ de départ
    assert.equal(await bddService.purchaseBalls('g5', 'u5', 'hyperball', 10, 700), 1);
    assert.equal(await bddService.getMoneyForUser('g5', 'u5'), 500);
    assert.deepEqual(await bddService.getBallsForUser('g5', 'u5'), stocks({}));
    assert.equal((await bddService.getDresseur('g5', 'u5')).ballsAchetees, 0, 'achat refusé : compteur inchangé');

    assert.equal(await bddService.purchaseBalls('g5', 'u5', 'pokeball', 5, 100), 0);
    assert.equal(await bddService.getMoneyForUser('g5', 'u5'), 400);
    assert.deepEqual(await bddService.getBallsForUser('g5', 'u5'), stocks({ pokeball: 5 }));
    assert.equal((await bddService.getDresseur('g5', 'u5')).ballsAchetees, 5, 'compteur ballsAchetees alimenté');
});

test('captures : Pokédex et compteurs', async () => {
    await bddService.createNewUser('g6', 'u6', 'j6');
    assert.equal(await bddService.alreadyCaptured('g6', 'u6', 25), false);
    assert.equal(await bddService.getPokedexStateForUser('g6', 'u6'), 0);

    await bddService.registerNewCapture('g6', 'u6', 25);
    assert.equal(await bddService.alreadyCaptured('g6', 'u6', 25), true);
    assert.equal(await bddService.getPokedexStateForUser('g6', 'u6'), 1);

    await bddService.registerNewCapture('g6', 'u6', 6);
    assert.equal(await bddService.getPokedexStateForUser('g6', 'u6'), 2);
    assert.equal((await bddService.getDresseur('g6', 'u6')).nbrCapture, 2);

    await bddService.incrementCaptureCount('g6', 'u6');
    assert.equal((await bddService.getDresseur('g6', 'u6')).nbrCapture, 3);
    assert.equal(await bddService.getPokedexStateForUser('g6', 'u6'), 2, 'doublon : Pokédex inchangé');
});

test('travail : réservation atomique et horodatage', async () => {
    await bddService.createNewUser('g7', 'u7', 'j7');
    assert.equal(await bddService.userGoToWork('g7', 'u7'), 0);
    assert.equal(await bddService.userGoToWork('g7', 'u7'), 1, 'déjà au travail');

    const start = await bddService.getStartWorkTimeUser('g7', 'u7');
    assert.ok(typeof start === 'number' && start > 0, 'workStartTime enregistré');

    await bddService.updateOneFieldForOneUser('g7', 'u7', 'isWorking', 0);
    assert.equal(await bddService.userGoToWork('g7', 'u7'), 0, 'peut repartir après libération');
});

test('resetIsWorking : limité à la guild passée', async () => {
    await bddService.createNewUser('g8', 'u8', 'j8');
    await bddService.createNewUser('g9', 'u8', 'j8');
    await bddService.userGoToWork('g8', 'u8');
    await bddService.userGoToWork('g9', 'u8');

    await bddService.resetIsWorking('g8');
    assert.equal((await bddService.getDresseur('g8', 'u8')).isWorking, 0);
    assert.equal((await bddService.getDresseur('g9', 'u8')).isWorking, 1, 'autre guild non touchée');
});

test('recordGamePlayed/getGameLastPlayedAt : isolation par serveur et par jeu', async () => {
    await bddService.createNewUser('g10', 'u10', 'j10');
    await bddService.createNewUser('g11', 'u10', 'j10');
    const maintenant = new Date();

    assert.equal(await bddService.getGameLastPlayedAt('g10', 'u10', 'type'), null, 'jamais joué');
    await bddService.recordGamePlayed('g10', 'u10', 'type', maintenant);
    assert.equal(
        (await bddService.getGameLastPlayedAt('g10', 'u10', 'type')).getTime(),
        maintenant.getTime(),
        'date de jeu enregistrée'
    );
    assert.equal(await bddService.getGameLastPlayedAt('g11', 'u10', 'type'), null, 'autre guild non touchée');
    assert.equal(await bddService.getGameLastPlayedAt('g10', 'u10', 'weight'), null, 'jeton indépendant par jeu');
});

test('resetIsWorking(null) : toutes les guilds (comportement mono-serveur)', async () => {
    await bddService.createNewUser('g12', 'u12', 'j12');
    await bddService.createNewUser('g13', 'u12', 'j12');
    await bddService.userGoToWork('g12', 'u12');
    await bddService.userGoToWork('g13', 'u12');

    await bddService.resetIsWorking(null);
    assert.equal((await bddService.getDresseur('g12', 'u12')).isWorking, 0);
    assert.equal((await bddService.getDresseur('g13', 'u12')).isWorking, 0);
});

test('settleCasinoBet : atomique, refuse si solde insuffisant', async () => {
    await bddService.createNewUser('gc', 'uc', 'jc'); // 500$ de départ

    // Perte : mise débitée
    assert.equal(await bddService.settleCasinoBet('gc', 'uc', 50, -50), 0);
    assert.equal(await bddService.getMoneyForUser('gc', 'uc'), 450);

    // Remboursement : solde inchangé
    assert.equal(await bddService.settleCasinoBet('gc', 'uc', 50, 0), 0);
    assert.equal(await bddService.getMoneyForUser('gc', 'uc'), 450);

    // Gain : gain crédité net de la mise
    assert.equal(await bddService.settleCasinoBet('gc', 'uc', 50, 500), 0);
    assert.equal(await bddService.getMoneyForUser('gc', 'uc'), 950);

    // Statistiques : mises cumulées (50+50+50) et gains bruts (0+50+550)
    assert.equal((await bddService.getDresseur('gc', 'uc')).argentMise, 150);
    assert.equal((await bddService.getDresseur('gc', 'uc')).argentGagne, 600);

    // Mise supérieure au solde : refusée, aucun débit
    assert.equal(await bddService.settleCasinoBet('gc', 'uc', 1000, -1000), 1);
    assert.equal(await bddService.getMoneyForUser('gc', 'uc'), 950);
    assert.equal((await bddService.getDresseur('gc', 'uc')).argentMise, 150, 'mise refusée non comptée');
});

test('casinoService.play : chaîne complète tirage + règlement atomique', async (t) => {
    await bddService.createNewUser('gd', 'ud', 'jd'); // 500$ de départ

    // rng = 0 tombe sur le premier lot de la table (le plus rare)
    t.mock.method(Math, 'random', () => 0);
    const result = await casinoService.play('gd', 'ud', 10);
    const jackpot = casinoService.getPayouts()[0];

    assert.equal(result.settled, true, 'pari réglé');
    assert.equal(result.payout.multiplier, jackpot.multiplier);
    assert.equal(result.gain, jackpot.multiplier * 10);
    assert.equal(result.netChange, jackpot.multiplier * 10 - 10);
    assert.equal(result.balance, 500 + result.netChange);
});

test('stats : échecs de capture, agrégats et top isolés par serveur', async () => {
    await bddService.createNewUser('gs1', 'us1', 'js1');
    await bddService.createNewUser('gs1', 'us2', 'js2');
    await bddService.createNewUser('gs2', 'us1', 'autre-serveur');

    await bddService.gainMoney('gs1', 'us1', 200);
    await bddService.purchaseBalls('gs1', 'us1', 'pokeball', 3, 60);
    await bddService.settleCasinoBet('gs1', 'us1', 40, -40);
    await bddService.incrementerEchecCapture('gs1', 'us1');
    await bddService.incrementerEchecCapture('gs1', 'us1');
    await bddService.incrementerEchecCapture('gs1', 'us2');

    const stats = await bddService.getStatsDresseurs('gs1');
    assert.equal(stats.dresseurs, 2, 'dresseurs du serveur uniquement');
    assert.equal(stats.argentGagne, 200, 'gains bruts (200 hors casino, 0 au casino)');
    assert.equal(stats.ballsAchetees, 3);
    assert.equal(stats.capturesEchouees, 3);
    assert.equal(stats.argentMise, 40);
    assert.equal(stats.argentEnCirculation, 500 + 200 - 60 - 40 + 500, 'somme des soldes');

    // Isolation : l'autre serveur ne compte pas les stats de gs1
    const statsAutre = await bddService.getStatsDresseurs('gs2');
    assert.equal(statsAutre.dresseurs, 1);
    assert.equal(statsAutre.argentGagne, 0);
    assert.equal(statsAutre.capturesEchouees, 0);

    // Top classé par argent accumulé (us1 devant us2)
    const top = await bddService.getTopDresseurs('gs1', 5);
    assert.equal(top.length, 2);
    assert.equal(top[0].userId, 'us1');
    assert.equal(top[0].argentGagne, 200);
    assert.equal(top[0].ballsAchetees, 3);
    assert.equal(top[0].capturesEchouees, 2);
    assert.equal(top[0].argentMise, 40);
    assert.equal(top[1].userId, 'us2');
    assert.equal(top[1].argentGagne, 0);

    // Base vide : agrégats à 0 sans erreur
    const statsVide = await bddService.getStatsDresseurs('gs-inexistante');
    assert.equal(statsVide.dresseurs, 0);
    assert.equal(statsVide.argentGagne, 0);
    assert.deepEqual(await bddService.getTopDresseurs('gs-inexistante', 5), []);
});

test('dresseur inexistant : valeurs par défaut sûres', async () => {
    assert.equal(await bddService.getMoneyForUser('gx', 'ux'), 0);
    assert.deepEqual(await bddService.getBallsForUser('gx', 'ux'), stocks({}));
    assert.equal(await bddService.getPokedexStateForUser('gx', 'ux'), 0);
    assert.equal(await bddService.getStartWorkTimeUser('gx', 'ux'), null);
    assert.equal(await bddService.getGameLastPlayedAt('gx', 'ux', 'type'), null);
});

test('getClassementDresseurs : Pokédex distinct, captures totales, isolation et limite', async () => {
    // Serveur gc1 : uc1 (2 distincts, 5 captures), uc2 (2 distincts, 2 captures),
    // uc3 (aucune capture) ; uc9 capture uniquement sur le serveur voisin
    await bddService.createNewUser('gc1', 'uc1', 'carapuce');
    await bddService.createNewUser('gc1', 'uc2', 'bulbizarre');
    await bddService.createNewUser('gc1', 'uc3', 'magicarpe');
    await bddService.createNewUser('gc2', 'uc9', 'mew');

    // uc1 : Pikachu (25) + Evoli (133) + trois doublons revendus
    await bddService.registerNewCapture('gc1', 'uc1', 25);
    await bddService.registerNewCapture('gc1', 'uc1', 133);
    await bddService.incrementCaptureCount('gc1', 'uc1');
    await bddService.incrementCaptureCount('gc1', 'uc1');
    await bddService.incrementCaptureCount('gc1', 'uc1');
    // uc2 : Bulbizarre (1) + Salamèche (4)
    await bddService.registerNewCapture('gc1', 'uc2', 1);
    await bddService.registerNewCapture('gc1', 'uc2', 4);
    // uc9 : capture uniquement sur l'autre serveur
    await bddService.registerNewCapture('gc2', 'uc9', 151);

    // Critère 'pokedex' (défaut) : 2-2-0, égalité uc1/uc2 départagée par nom
    const parPokedex = await bddService.getClassementDresseurs('gc1');
    assert.equal(parPokedex.length, 3);
    assert.deepEqual(parPokedex.map((d) => d.userId), ['uc2', 'uc1', 'uc3']);
    assert.deepEqual(parPokedex.map((d) => d.score), [2, 2, 0]);
    assert.ok(parPokedex.every((d) => typeof d.name === 'string'), 'nom projeté');
    assert.ok(!parPokedex.some((d) => d.userId === 'uc9'), 'isolation par serveur');

    // Critère 'captures' : doublons inclus, uc1 passe devant
    const parCaptures = await bddService.getClassementDresseurs('gc1', 'captures');
    assert.deepEqual(parCaptures.map((d) => d.userId), ['uc1', 'uc2', 'uc3']);
    assert.deepEqual(parCaptures.map((d) => d.score), [5, 2, 0]);

    // Limite respectée, base vide sans erreur
    assert.equal((await bddService.getClassementDresseurs('gc1', 'pokedex', 2)).length, 2);
    assert.deepEqual(await bddService.getClassementDresseurs('gc-inexistante'), []);

    // Critère 'egg' : uc2 fait éclore un œuf et prend la tête
    await bddService.giveEgg('gc1', 'uc2');
    for (let i = 0; i < 10; i++) {
        await bddService.progressEgg('gc1', 'uc2');
    }
    assert.equal(await bddService.hatchEgg('gc1', 'uc2', 42, 10), 0);
    const parEgg = await bddService.getClassementDresseurs('gc1', 'egg');
    assert.deepEqual(parEgg.map((d) => d.userId), ['uc2', 'uc1', 'uc3']);
    assert.deepEqual(parEgg.map((d) => d.score), [1, 0, 0]);

    // Document antérieur à la feature (sans champ oeufsEclos) : score 0
    await bddService.createOperation('dresseurs', { _id: { guildId: 'gc4', userId: 'uL' }, name: 'ancien' });
    const legacy = await bddService.getClassementDresseurs('gc4', 'egg');
    assert.equal(legacy.length, 1);
    assert.equal(legacy[0].score, 0, 'compteur absent = 0 œuf éclos');
});

test('œuf : obtention unique, progression atomique, éclosion au seuil', async () => {
    await bddService.createNewUser('ge1', 'ue1', 'je1');

    // Pas d'œuf : la progression ne fait rien
    assert.equal(await bddService.progressEgg('ge1', 'ue1'), null);

    // Dresseur inexistant : obtention refusée sans effet
    assert.equal(await bddService.giveEgg('ge1', 'inconnu'), 1);

    // Obtention : la condition "pas d'œuf en cours" est dans le filtre,
    // un second appel ne peut pas écraser l'œuf en incubation
    assert.equal(await bddService.giveEgg('ge1', 'ue1'), 0);
    assert.equal(await bddService.giveEgg('ge1', 'ue1'), 1);

    // Progression : 9 captures, l'éclosion est refusée avant le seuil
    for (let i = 1; i <= 9; i++) {
        const etat = await bddService.progressEgg('ge1', 'ue1');
        assert.equal(etat.eggActive, 1);
        assert.equal(etat.eggCaptures, i, 'valeur retournée après incrément');
    }
    assert.equal(await bddService.hatchEgg('ge1', 'ue1', 42, 10), 1, 'éclosion refusée sous le seuil');
    assert.equal((await bddService.getEggState('ge1', 'ue1')).eggCaptures, 9);

    // 10e capture : éclosion, Pokémon marqué, œuf réinitialisé
    await bddService.progressEgg('ge1', 'ue1');
    assert.equal(await bddService.hatchEgg('ge1', 'ue1', 42, 10), 0);
    const etatFinal = await bddService.getEggState('ge1', 'ue1');
    assert.equal(etatFinal.eggActive, 0);
    assert.equal(etatFinal.eggCaptures, 0);
    const doc = await bddService.getDresseur('ge1', 'ue1');
    assert.equal(doc[42], 1, 'Pokémon de l\'œuf ajouté au Pokédex');
    assert.equal(doc.nbrCapture, 0, 'l\'éclosion ne compte pas comme une capture');
    assert.equal(doc.oeufsEclos, 1, 'compteur d\'œufs éclos incrémenté (la tentative refusée sous le seuil ne compte pas)');

    // Après éclosion, un nouvel œuf peut être confié, et le compteur cumule
    assert.equal(await bddService.giveEgg('ge1', 'ue1'), 0);
    for (let i = 0; i < 10; i++) {
        await bddService.progressEgg('ge1', 'ue1');
    }
    assert.equal(await bddService.hatchEgg('ge1', 'ue1', 43, 10), 0);
    assert.equal((await bddService.getDresseur('ge1', 'ue1')).oeufsEclos, 2, 'compteur cumulatif sur plusieurs éclosions');
});
