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
    const started = await workService.startWork(dresseurId);

    if (started) {
        await channelService.replySafe(message, "⛏️ Tu commences à travailler... Reviens dans 1 heure pour récupérer ta paye !");
    } else {
        await channelService.replySafe(message, "⏳ T'es déjà au travail, patience mon gars !");
    }
}

// Metadata pour l'aide automatique
export const metadata = {
    name: 'work',
    description: 'Travaille pour gagner de l\'argent',
    usage: '!work',
    category: 'Économie'
};
