/**
 * Utilitaire pour envoyer des stickers via l'API Giphy
 *
 * Précision des résultats : la recherche est faite sur /v1/stickers/search avec
 * l'expression exacte entre guillemets suivie du tag de channel "@pokemon" DANS
 * le paramètre q (doc officielle : "@username" dans q filtre le contenu d'un
 * channel côté serveur). Repli : nom exact + @pokemon -> nom + @pokemon ->
 * stickers/translate (s + @pokemon, meilleur match).
 *
 * Exemple d'utilisation :
 *   import { sendGif } from './utils/gif.js';
 *   await sendGif('pikachu @pokemon');
 */

import { channelService } from '../services/channel/ChannelService.js';


// Clé API Giphy : à renseigner dans le .env (variable GIPHY_API_KEY)
const GIPHY_API_KEY = process.env.GIPHY_API_KEY;

// Compte Giphy officiel Pokémon : filtre de pertinence des résultats
const COMPTE_OFFICIEL = 'pokemon';

/**
 * Nettoie le mot-clé et sépare le tag de channel : nettoie le nom (caractères
 * spéciaux retirés : Farfetch'd, Mr. Mime, Nidoran♀...) et conserve le tag
 * "@..." pour le passer dans q (filtrage channel côté serveur, doc Giphy).
 * @param {string} keyword - Mot-clé brut (ex: "Farfetch'd @pokemon")
 * @returns {{ nom: string, tag: string }} - ex: { nom: 'Farfetchd', tag: '@pokemon' }
 */
function nettoyerMotCle(keyword) {
    const brut = String(keyword);
    const at = brut.indexOf('@');
    const tag = at !== -1 ? brut.slice(at).trim() : '@' + COMPTE_OFFICIEL;
    const nom = (at !== -1 ? brut.slice(0, at) : brut)
        .replace(/[^a-zA-Z0-9 ]/g, '')     // apostrophes, points, symboles...
        .trim();
    return { nom, tag };
}

/**
 * Appelle l'API Giphy et renvoie le JSON décodé
 * @param {string} path - Chemin de l'endpoint (ex: 'stickers/search')
 * @param {Object} params - Paramètres de requête (hors api_key)
 * @returns {Promise<Object>} - Réponse JSON de l'API
 */
async function giphyFetch(path, params) {
    const url = new URL(`https://api.giphy.com/v1/${path}`);
    url.searchParams.set('api_key', GIPHY_API_KEY);
    for (const [cle, valeur] of Object.entries(params)) {
        url.searchParams.set(cle, valeur);
    }
    console.log('Je cherche un gif avec le keyword ' + (url.searchParams.get('q') ?? url.searchParams.get('s') ?? ''));
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Giphy API error: ${response.status} ${response.statusText}`);
    }
    return await response.json();
}

/**
 * Recherche l'URL d'un sticker du mot-clé, le channel officiel Pokémon étant
 * DANS la requête (tag @pokemon dans q, filtre serveur selon la doc Giphy).
 * Cascade : exact + @pokemon -> nom + @pokemon -> stickers/translate (s + @pokemon)
 * @param {string} keyword - Mot-clé (ex: "Pikachu @pokemon")
 * @returns {Promise<string|null>} - URL du sticker, ou null si rien trouvé
 */
async function rechercherGif(keyword) {
    const { nom, tag } = nettoyerMotCle(keyword);
    if (!nom) return null;
    const paramsBase = { rating: 'pg-13', lang: 'en', limit: 50 };

    // 1) expression exacte entre guillemets + channel dans q
    let data = await giphyFetch('stickers/search', { ...paramsBase, q: `"${nom}" ${tag}` });
    let gifs = data.data ?? [];

    // 2) repli : nom seul (sans guillemets) + channel dans q
    if (gifs.length === 0) {
        data = await giphyFetch('stickers/search', { ...paramsBase, q: `${nom} ${tag}` });
        gifs = data.data ?? [];
    }

    // 3) repli ultime : stickers/translate (s accepte aussi @channel)
    if (gifs.length === 0) {
        const t = await giphyFetch('stickers/translate', { s: `${nom} ${tag}`, rating: 'pg-13', lang: 'en' });
        return t.data?.images?.original?.url ?? null;
    }

    // Tirage aléatoire parmi les résultats (déjà filtrés channel côté serveur)
    const gif = gifs[Math.floor(Math.random() * gifs.length)];
    return gif.images.original.url;
}

    /**
 * Envoie un sticker animé aléatoire depuis Giphy dans un channel Discord
 * @param {string} keyword - Mot-clé de la recherche (ex: 'pikachu')
 * @param {Object} [message] - Message Discord auquel répondre ; si absent, envoie dans le channel fixe du ChannelService
 * @returns {Promise<void>} - Envoie un message d'erreur dans le channel en cas d'échec
 */
export async function sendGif(keyword, message = null) {

    // Cible : réponse au message si fourni, sinon le channel fixe du ChannelService
    const send = (content) => message ? message.reply(content) : channelService.sendMessage(content);

    try {
        const gifUrl = await rechercherGif(keyword);
        if (gifUrl) {
            await send(gifUrl);
        } else {
            console.log('[GIF] Aucun résultat pour : ' + keyword);
            await send("Aucun GIF trouvé pour ce mot-clé. Essaie autre chose !");
        }
    } catch (error) {
        console.error("[GIF] Erreur:", error.message);
        await send("❌ Désolé, je n'ai pas pu récupérer un GIF. Réessaye plus tard !");
    }
}
