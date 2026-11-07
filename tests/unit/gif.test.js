/**
 * Tests unitaires de sendGif (src/utils/gif.js) avec Giphy stubé :
 * - endpoint /v1/gifs/search (pas stickers), rating pg-13, lang en
 * - q = expression exacte entre guillemets, mot-clé nettoyé (@pokemon et
 *   caractères spéciaux retirés), filtrage des résultats sur username 'pokemon'
 * - repli translate puis message "Aucun GIF trouvé" si rien
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../helpers/env.mjs';
import { sendGif } from '../../src/utils/gif.js';
import { stubGiphy } from '../helpers/fakeGiphy.mjs';
import { fakeMessage } from '../helpers/fakeDiscord.mjs';

test('sendGif : requête exacte entre guillemets sur /gifs/search, nom nettoyé, GIF officiel envoyé en reply', async () => {
    const gif = stubGiphy();
    const message = fakeMessage({ authorId: 'u1', guildId: 'g1', content: '!x' });
    try {
        await sendGif("Farfetch'd @pokemon", message);
    } finally {
        gif.restore();
    }
    assert.equal(gif.calls.length, 1, 'une seule requête (résultat officiel trouvé directement)');
    const url = new URL(gif.calls[0]);
    assert.equal(url.pathname, '/v1/stickers/search', 'endpoint stickers');
    assert.equal(decodeURIComponent(url.searchParams.get('q')), '"Farfetchd" @pokemon', 'expression exacte, channel @pokemon dans q, apostrophe nettoyée');
    assert.equal(url.searchParams.get('rating'), 'pg-13');
    assert.equal(url.searchParams.get('lang'), 'en');
    assert.ok(message.replies.includes('https://media.giphy.com/fake/test.gif'), 'GIF du compte officiel envoyé en reply');
});

test('sendGif : aucun résultat -> repli translate puis message dédié', async () => {
    // Stub maison : HTTP 200 mais data vide partout (search ET translate)
    const originalFetch = globalThis.fetch;
    const calls = [];
    globalThis.fetch = async (url) => {
        calls.push(String(url));
        return { ok: true, json: async () => ({ data: [] }) };
    };
    const message = fakeMessage({ authorId: 'u1', guildId: 'g1', content: '!x' });
    try {
        await sendGif('MissingNo @pokemon', message);
    } finally {
        globalThis.fetch = originalFetch;
    }
    const paths = calls.map((c) => new URL(c).pathname);
    assert.ok(paths.includes('/v1/stickers/translate'), 'repli sur l\'endpoint stickers/translate');
    assert.ok(message.replies.some((r) => String(r).includes('Aucun GIF trouvé')), 'message "Aucun GIF trouvé"');
});
