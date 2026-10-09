/**
 * Utilitaire pour envoyer des GIFs via l'API Giphy
 * 
 * Exemple d'utilisation :
 *   import { sendGif } from './utils/gif.js';
 *   await sendGif('pikachu');
 */
import { channelService } from '../services/channel/ChannelService.js';


// Clé API Giphy : à renseigner dans le .env (variable GIPHY_API_KEY)
const GIPHY_API_KEY = process.env.GIPHY_API_KEY;

/**
 * Envoie un GIF/sticker aléatoire depuis Giphy dans un channel Discord
 * @param {string} keyword - Mot-clé de la recherche (ex: 'pikachu @pokemon')
 * @param {Object} [message] - Message Discord auquel répondre ; si absent, envoie dans le channel fixe du ChannelService
 * @returns {Promise<void>} - Envoie un message d'erreur dans le channel en cas d'échec
 */
export async function sendGif(keyword, message = null) {
    // Cible : réponse au message si fourni, sinon le channel fixe du ChannelService
    const send = (content) => message ? message.reply(content) : channelService.sendMessage(content);
    try {
        console.log("Je cherche un gif avec le keyword " + keyword);
        console.log("encodeURIComponent =  " + encodeURIComponent(keyword));
        // Encodage du keyword pour éviter les problèmes d'URL
        const searchUrl = `https://api.giphy.com/v1/stickers/search?q=${encodeURIComponent(keyword)}&api_key=${GIPHY_API_KEY}&rating=pg-13`;
        const response = await fetch(searchUrl);

        if (!response.ok) {
            throw new Error(`Giphy API error: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();

        // /stickers/search renvoie un tableau de résultats
        if (!Array.isArray(data.data) || data.data.length === 0) {
            console.log("[GIF] Réponse de GIPHY : ", data);
            await send("Aucun GIF trouvé pour ce mot-clé. Essaie autre chose !");
            return;
        }

        // Récupère l'URL du sticker en haute qualité
        const gif = data.data[Math.floor(Math.random() * data.data.length)];
        const gifUrl = gif.images.original.url;
        await send(gifUrl);

    } catch (error) {
        console.error("[GIF] Erreur:", error.message);
        await send("❌ Désolé, je n'ai pas pu récupérer un GIF. Réessaye plus tard !");
    }
}
