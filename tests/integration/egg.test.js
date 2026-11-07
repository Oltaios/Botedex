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
 * l'éclosion déterministe. Le numéro attendu se calcule depuis la config :
 * floor(rng * game.numberOfPokemon) + 1 (ex: 0.37 -> n°93 avec 251 Pokémon).
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import '../helpers/env.mjs';
import { encodeDexBits, setBitDex, decodeDexBits } from '../../src/utils/dexBits.js';
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
const { getConfig } = await import('../../src/utils/configLoader.js');

const NB_POKEMON = getConfig().game.numberOfPokemon;
/** Numéro de Pokémon tiré pour un Math.random figé (RandomUtils.nombreAleatoire) */
const pkmPourRng = (rng) => Math.floor(rng * NB_POKEMON) + 1;

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

    // Capture du seuil : éclosion déterministe (numéro calculé depuis numberOfPokemon)
    const attendu = pkmPourRng(0.37);
    const restaurer = fixerRandom(0.37);
    let numEclos;
    try {
        numEclos = await eggService.onCapture(GUILD, 'u-eclosion');
    } finally {
        restaurer();
    }
    assert.equal(numEclos.numPkm, attendu, 'numéro du Pokémon issu de l\'œuf');
    assert.equal(numEclos.doublon, false, 'pas de doublon sur un dresseur sans capture');

    const doc = await bddService.getDresseur(GUILD, 'u-eclosion');
    assert.equal(await bddService.alreadyCaptured(GUILD, 'u-eclosion', attendu), true, 'Pokémon ajouté au Pokédex (bit dexBits)');
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
    // éclos sur cette capture (numéro calculé depuis numberOfPokemon)
    setNumPkmAvailable(NUM_PKM);
    const message = fakeMessage({
        authorId: userId,
        guildId: GUILD,
        channel: fakeChannel({ id: CHANNEL_ID }),
        content: '!capture pokeball'
    });
    const { parsingPkm } = await import('../../src/utils/parsing.js');
    const { stubGiphy } = await import('../helpers/fakeGiphy.mjs');
    const gif = stubGiphy();
    const restaurer = fixerRandom(0.5);
    try {
        await captureService.gererEventCapture(message, `capture-${userId}`, 'pokeball');
    } finally {
        restaurer();
        gif.restore();
    }

    const doc = await bddService.getDresseur(GUILD, userId);
    // rng 0.5 < 2/3 : tirage parmi les non-obtenus (NUM_PKM exclu, capturé entre-temps)
    const nonObtenus = Array.from({ length: NB_POKEMON }, (_, i) => i + 1).filter((n) => n !== NUM_PKM);
    const attendu = nonObtenus[Math.floor(0.5 * nonObtenus.length)];
    assert.equal(await bddService.alreadyCaptured(GUILD, userId, attendu), true, 'Pokémon issu de l\'œuf ajouté au Pokédex (bit dexBits)');
    assert.equal(doc.eggActive, 0, 'œuf réinitialisé');
    assert.equal(doc.oeufsEclos, 1, 'compteur d\'œufs éclos incrémenté');
    assert.equal(await eggService.getEtatOeuf(GUILD, userId), null, 'plus d\'œuf en incubation');
    assert.ok(message.replies.some((r) => String(r).includes('éclos')), 'éclosion annoncée dans le flux de capture');
    // Message d'éclosion : nom et numéro du Pokémon en gras (ex: **Roucool [16]**)
    assert.ok(
        message.replies.some((r) => String(r).includes('**') && String(r).includes('[' + attendu + ']')),
        'nom + numéro du Pokémon en gras'
    );
    // GIF de l'éclosion : recherché avec le nom ANGLAIS + @pokemon, envoyé en reply
    const qGif = decodeURIComponent(new URL(gif.calls[0]).searchParams.get('q'));
    assert.equal(qGif, '"' + parsingPkm(attendu)[0] + '" @pokemon', 'GIF recherché en expression exacte (nom anglais entre guillemets)');
    assert.ok(message.replies.includes('https://media.giphy.com/fake/test.gif'), 'GIF du Pokémon éclos envoyé en reply');
});

test('éclosion : 1 chance sur 3 -> tirage uniforme parmi tous les Pokémon', async () => {
    const G = 'g-oeuf-uniforme';
    await bddService.createNewUser(G, 'u10', 'Jim');
    await eggService.donnerOeuf(G, 'u10');
    for (let i = 1; i < SEUIL; i++) await eggService.onCapture(G, 'u10');
    const attendu = pkmPourRng(0.9); // floor(0.9 * NB_POKEMON) + 1
    const restaurer = fixerRandom(0.9); // 0.9 >= 2/3 -> branche uniforme
    let res;
    try {
        res = await eggService.onCapture(G, 'u10');
    } finally {
        restaurer();
    }
    assert.equal(res.numPkm, attendu, 'tirage uniforme 1..numberOfPokemon');
    assert.equal(res.doublon, false, 'dresseur vierge : pas de doublon');
    assert.equal(await bddService.alreadyCaptured(G, 'u10', attendu), true, 'Pokémon ajouté au Pokédex (bit dexBits)');
});

test('éclosion : Pokémon déjà possédé -> doublon, récompense créditée via duplicateCaptureReward', async () => {
    const G = 'g-oeuf-doublon';
    await bddService.createNewUser(G, 'u11', 'Kim');
    const cible = pkmPourRng(0.9);
    await bddService.registerNewCapture(G, 'u11', cible); // déjà au Pokédex
    await eggService.donnerOeuf(G, 'u11');
    for (let i = 1; i < SEUIL; i++) await eggService.onCapture(G, 'u11');
    const restaurer = fixerRandom(0.9); // branche uniforme -> retombe sur cible
    let res;
    try {
        res = await eggService.onCapture(G, 'u11');
    } finally {
        restaurer();
    }
    assert.equal(res.numPkm, cible);
    assert.equal(res.doublon, true, 'doublon détecté');
    assert.ok(typeof res.message === 'string' && res.message.length > 0, 'message doublon préparé par EggService');
    assert.ok(res.message.includes('[' + cible + ']'), 'message avec le numéro du Pokémon');
    assert.ok(res.message.includes('50$'), 'message avec la récompense de doublon');
    const doc = await bddService.getDresseur(G, 'u11');
    assert.equal(doc.argent, 500 + 50, 'récompense de doublon (economy.duplicateCaptureReward = 50) créditée');
    assert.equal(doc.oeufsEclos, 1, 'œuf bien consommé malgré le doublon');
});

test('éclosion : 2 chances sur 3 -> Pokémon non obtenu garanti quand il en reste un seul', async () => {
    const G = 'g-oeuf-garanti';
    await bddService.createNewUser(G, 'u12', 'Lee');
    // Le dresseur possède tout sauf le n°42 (bitset dexBits, format migré)
    let bits = decodeDexBits(null, NB_POKEMON);
    for (let i = 1; i <= NB_POKEMON; i++) if (i !== 42) bits = setBitDex(bits, i);
    await bddService.db.collection('dresseurs').updateOne(
        { _id: { guildId: G, userId: 'u12' } },
        { $set: { dexBits: encodeDexBits(bits), dexCount: NB_POKEMON - 1 } }
    );
    await eggService.donnerOeuf(G, 'u12');
    for (let i = 1; i < SEUIL; i++) await eggService.onCapture(G, 'u12');
    const restaurer = fixerRandom(0.5); // 0.5 < 2/3 -> branche non-obtenus
    let res;
    try {
        res = await eggService.onCapture(G, 'u12');
    } finally {
        restaurer();
    }
    assert.equal(res.numPkm, 42, 'seul Pokémon non obtenu restant, tiré à coup sûr');
    assert.equal(res.doublon, false);
    assert.equal(await bddService.alreadyCaptured(G, 'u12', 42), true, 'bit posé dans dexBits');
});

test('éclosion : un GIF du Pokémon éclos est envoyé (nom anglais + @pokemon)', async () => {
    const { parsingPkm } = await import('../../src/utils/parsing.js');
    const { stubGiphy } = await import('../helpers/fakeGiphy.mjs');
    const G = 'g-oeuf-gif';
    await bddService.createNewUser(G, 'u13', 'Nina');
    await eggService.donnerOeuf(G, 'u13');
    for (let i = 1; i < SEUIL; i++) await eggService.onCapture(G, 'u13');
    const attendu = pkmPourRng(0.37); // 0.37 < 2/3 -> tirage non-obtenus (tous dispo)
    const gif = stubGiphy();
    const restaurer = fixerRandom(0.37);
    const message = fakeMessage({ authorId: 'u13', guildId: G, channel: fakeChannel({ id: CHANNEL_ID }), content: '!capture pokeball' });
    let res;
    try {
        res = await eggService.onCapture(G, 'u13', message);
    } finally {
        restaurer();
        gif.restore();
    }
    assert.equal(res.numPkm, attendu);
    assert.equal(gif.calls.length, 1, 'une seule recherche Giphy');
    const q = decodeURIComponent(new URL(gif.calls[0]).searchParams.get('q'));
    assert.equal(q, '"' + parsingPkm(attendu)[0] + '" @pokemon', 'GIF recherché en expression exacte avec le nom ANGLAIS');
    assert.ok(message.replies.includes('https://media.giphy.com/fake/test.gif'), 'GIF envoyé en reply au message');
    assert.ok(message.replies.some((r) => String(r).includes('éclos')), 'message d\'éclosion envoyé en reply');
});
