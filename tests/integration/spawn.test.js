/**
 * Tests d'intégration du spawn (SpawnService) avec le fake Giphy
 * Garde-fou de la régression historique : le GIF doit être cherché avec le
 * NOM ANGLAIS (colonne name) et l'annonce affichée avec le NOM FRANÇAIS
 * (colonne nameFR). Pas de base de données : le spawn n'écrit rien.
 */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import '../helpers/env.mjs';
import { stubGiphy } from '../helpers/fakeGiphy.mjs';

const { client } = await import('../../src/core/client.js');
const { channelService } = await import('../../src/services/channel/ChannelService.js');
const { spawnService } = await import('../../src/services/game/SpawnService.js');
const {
    getNumPkmAvailable,
    getLockPkmAvailable,
    getTentativesCapture,
    clearTentativesCapture
} = await import('../../src/core/client.js');
const { fakeChannel } = await import('../helpers/fakeDiscord.mjs');

const CHANNEL_ID = 'chan-spawn';
let channel;

before(async () => {
    client.user = { id: 'bot-spawn' };
    channel = fakeChannel({ id: CHANNEL_ID });
    client.channels.cache.set(CHANNEL_ID, channel);
    await channelService.init(CHANNEL_ID);
});

test('spawn : annonce le nom FR, cherche le GIF avec le nom EN + @pokemon', async (t) => {
    const gif = stubGiphy();
    t.after(() => gif.restore());
    // 1er random = 0.5 (>= 1% : pool commun), 2e = 0 : index 0 du pool -> Pokémon n°1 (Bulbasaur)
    const seqCommun = [0.5, 0];
    t.mock.method(Math, 'random', () => (seqCommun.length ? seqCommun.shift() : 0.99));

    // Etat pollué par d'éventuels tests précédents : on repart de zéro
    clearTentativesCapture();

    await spawnService.spawnPokemon();
    // Les sendMessage non attendus s'exécutent en microtâches
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(getNumPkmAvailable(), 1, 'Bulbasaur (n°1) est le spawn actif');
    assert.equal(getLockPkmAvailable(), 0, 'spawn libre à la capture');
    assert.equal(getTentativesCapture().size, 0, 'tentatives remises à zéro');

    // Annonce : nom français
    assert.ok(
        channel.sent.some((m) => String(m).includes('Bulbizarre') && String(m).includes('[1]')),
        `annonce avec le nom FR : ${JSON.stringify(channel.sent)}`
    );

    // Recherche Giphy : nom ANGLAIS + tag @pokemon (la régression GIF)
    assert.equal(gif.calls.length, 1, 'une seule requête Giphy');
    const url = new URL(gif.calls[0]);
    assert.equal(url.hostname, 'api.giphy.com');
    assert.equal(decodeURIComponent(url.searchParams.get('q')), '"Bulbasaur" @pokemon', 'recherche exacte entre guillemets (filtrage channel via username)');

    // Le GIF puis l'appel à !capture partent dans le channel principal
    assert.ok(channel.sent.includes('https://media.giphy.com/fake/test.gif'));
    assert.ok(channel.sent.some((m) => String(m).includes('!capture')));
});

test('spawn : un tirage sous spawn.pokemonRarity.legendary (1%) fait apparaître un légendaire', async (t) => {
    const gif = stubGiphy();
    t.after(() => gif.restore());
    // 1er random = 0 (< 0.01 : pool légendaire), 2e = 0 : index 0 -> n°144 (Articuno/Artikodin, is_legendary=1)
    const seqLeg = [0, 0];
    t.mock.method(Math, 'random', () => (seqLeg.length ? seqLeg.shift() : 0.99));

    clearTentativesCapture();

    await spawnService.spawnPokemon();
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(getNumPkmAvailable(), 144, 'Artikodin (n°144, is_legendary=1) est le spawn actif');

    assert.ok(
        channel.sent.some((m) => String(m).includes('Artikodin') && String(m).includes('[144]')),
        `annonce avec le nom FR du légendaire : ${JSON.stringify(channel.sent)}`    );

    const url = new URL(gif.calls[0]);
    assert.equal(decodeURIComponent(url.searchParams.get('q')), '"Articuno" @pokemon', 'recherche exacte entre guillemets');
});
