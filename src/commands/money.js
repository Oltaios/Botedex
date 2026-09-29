/**
 * Commande !money
 * Affiche l'argent d'un utilisateur
 * 
 * Exemple d'utilisation :
 *   import { execute } from './commands/money.js';
 *   await execute(message);
 */

import { bddService } from '../services/bdd/BDDService.js';
import { channelService } from '../services/channel/ChannelService.js';

/**
 * Exécute la commande !money
 * Répond en reply au message de commande
 * @param {Object} message - Message Discord
 */
export async function execute(message) {
    const dresseurId = message.author.id;
    const moneyAvailable = await bddService.getMoneyForUser(dresseurId);
    await channelService.replySafe(message, `💰 Tu as ${moneyAvailable}$`);
}

// Metadata pour l'aide automatique
export const metadata = {
    name: 'money',
    description: 'Affiche ton solde d\'argent',
    usage: '!money',
    category: 'Économie'
};
