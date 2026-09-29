/**
 * Commande !gif
 * Envoie un GIF aléatoire depuis l'API Giphy
 * 
 * Exemple d'utilisation :
 *   import { execute } from './commands/gif.js';
 *   await execute(message, pendingResponses);
 */

import { sendGif } from '../utils/gif.js';
import { pendingResponses } from '../core/client.js';
import { channelService } from '../services/channel/ChannelService.js';

/**
 * Exécute la commande !gif
 * Demande un mot-clé puis envoie un sticker aléatoire correspondant
 * Répond en reply au message de commande
 * @param {Object} message - Message Discord ayant déclenché la commande
 * @param {Set<string>} pendingResponses - Clés des réponses en attente (réponse ignorée si le joueur est déjà en attente)
 * @returns {Promise<void>}
 */
export async function execute(message, pendingResponses) {
    const responseKey = `${message.channel.id}:${message.author.id}`;
    pendingResponses.add(responseKey);

    await channelService.replySafe(message, "Entrez votre tag pour le gif :D :");

    const filter = m => m.author.id === message.author.id && m.content.startsWith('!');
    const collector = message.channel.createMessageCollector({ filter, max: 1, time: 15000 });

    collector.on('collect', collected => {
        console.log(collected.content.substring(1));
        sendGif(collected.content.substring(1), message);
    });

    collector.on('end', () => {
        channelService.replySafe(message, "Gif terminated.");
        pendingResponses.delete(responseKey);
    });
}

// Metadata pour l'aide automatique
export const metadata = {
    name: 'gif',
    description: 'Envoie un GIF aléatoire depuis Giphy',
    usage: '!gif',
    category: 'Utilitaires'
};
