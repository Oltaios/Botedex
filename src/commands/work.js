/**
 * Commande !work
 * Permet à un utilisateur de "travailler" pour gagner de l'argent
 * 
 * Exemple d'utilisation :
 *   import { execute } from './commands/work.js';
 *   await execute(message);
 */

import { workService } from '../services/economy/WorkService.js';
import { channelService } from '../services/channel/ChannelService.js';

/**
 * Exécute la commande !work
 * Répond en reply au message de commande
 * @param {Object} message - Message Discord
 */
export async function execute(message) {
    const dresseurId = message.author.id;
    const started = await workService.startWork(message.guildId, dresseurId, message);
    // Timestamp de fin (secondes) pour le formatage Discord <t:...:R>
    const endWorkTime = await workService.getWorkEndTimestamp(message.guildId, dresseurId);

    if (started) {
        await channelService.replySafe(message, `⛏️ Tu commences à travailler... Fin du chantier <t:${endWorkTime}:R>, ta paye arrivera par pigeon voyageur mamène on fait ça bien.`);
    } else if (endWorkTime !== null) {
        await channelService.replySafe(message, `⏳ T'es déjà au travail, patience l'artiste ! Fin du chantier <t:${endWorkTime}:R>.`);
    } else {
        // Ancien dresseur sans workStartTime : pas d'info de fin exploitable
        //A supprimer plus tard
        await channelService.replySafe(message, `⏳ T'es déjà au travail, patience l'artiste !`);
    }
}

// Metadata pour l'aide automatique
export const metadata = {
    name: 'work',
    description: 'Travaille pour gagner de l\'argent',
    usage: '!work',
    category: 'Économie'
};
