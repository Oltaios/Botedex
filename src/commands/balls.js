/**
 * Commande !balls
 * Affiche l'inventaire de balls d'un utilisateur
 * 
 * Exemple d'utilisation :
 *   import { execute } from './commands/balls.js';
 *   await execute(message);
 */

import { bddService } from '../services/bdd/BDDService.js';
import { channelService } from '../services/channel/ChannelService.js';

/**
 * Exécute la commande !balls
 * Répond en reply au message de commande
 * @param {Object} message - Message Discord
 */
export async function execute(message) {
    const dresseurId = message.author.id;
    const ballsAvailable = await bddService.getBallsForUser(dresseurId);
    
    let toPrint = "🎒 Ce qui se trouve dans tes poches : \n";
    toPrint += `pokeball : ${ballsAvailable[0]}\n`;
    toPrint += `superball : ${ballsAvailable[1]}\n`;
    toPrint += `hyperball : ${ballsAvailable[2]}\n`;
    
    await channelService.replySafe(message, toPrint);
}

// Metadata pour l'aide automatique
export const metadata = {
    name: 'balls',
    description: 'Affiche ton inventaire de balls',
    usage: '!balls',
    category: 'Pokémon'
};
