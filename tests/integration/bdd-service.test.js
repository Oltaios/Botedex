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

    assert.equal(await bddService.purchaseBalls('g5', 'u5', 'pokeball', 5, 100), 0);
    assert.equal(await bddService.getMoneyForUser('g5', 'u5'), 400);
    assert.deepEqual(await bddService.getBallsForUser('g5', 'u5'), stocks({ pokeball: 5 }));
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

    // Mise supérieure au solde : refusée, aucun débit
    assert.equal(await bddService.settleCasinoBet('gc', 'uc', 1000, -1000), 1);
    assert.equal(await bddService.getMoneyForUser('gc', 'uc'), 950);
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

test('dresseur inexistant : valeurs par défaut sûres', async () => {
    assert.equal(await bddService.getMoneyForUser('gx', 'ux'), 0);
    assert.deepEqual(await bddService.getBallsForUser('gx', 'ux'), stocks({}));
    assert.equal(await bddService.getPokedexStateForUser('gx', 'ux'), 0);
    assert.equal(await bddService.getStartWorkTimeUser('gx', 'ux'), null);
    assert.equal(await bddService.getGameLastPlayedAt('gx', 'ux', 'type'), null);
});
