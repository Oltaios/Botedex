/**
 * Fake de l'API Giphy.
 * utils/gif.js appelle le fetch global : le stub remplace globalThis.fetch
 * et enregistre les URLs demandées pour vérifier les mots-clés de recherche
 * (garde-fou de la régression "GIFs recherchés avec le nom français").
 *
 * Utilisation :
 *   const gif = stubGiphy();
 *   try { ... } finally { gif.restore(); }
 */

/**
 * Branche un fetch factice répondant comme l'API Giphy
 * @param {Object} [options]
 * @param {string} [options.gifUrl] - URL de GIF renvoyée par le faux service
 * @param {boolean} [options.ok=true] - false pour simuler une erreur HTTP
 * @returns {{calls: string[], restore: Function}} - URLs capturées et restauration
 */
export function stubGiphy({ gifUrl = 'https://media.giphy.com/fake/test.gif', ok = true } = {}) {
    const originalFetch = globalThis.fetch;
    const calls = [];

    globalThis.fetch = async (url) => {
        calls.push(String(url));
        return {
            ok,
            json: async () => ({
                // /stickers/search renvoie un tableau de résultats
                data: ok ? [{ images: { original: { url: gifUrl } } }] : []
            })
        };
    };

    return {
        calls,
        restore: () => {
            globalThis.fetch = originalFetch;
        }
    };
}
