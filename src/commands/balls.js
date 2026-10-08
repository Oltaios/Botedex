/**
 * Commande !balls
 * Affiche l'inventaire de balls d'un utilisateur
 * 
 * Exemple d'utilisation :
 *   import { execute } from './commands/balls.js';
 *   await execute(message);
 */

import { bddService } from '../services/bdd/BDDService.js';
import { getConfig } from '../utils/configLoader.js';
import { channelService } from '../services/channel/ChannelService.js';

/**
 * Exécute la commande !balls
 * Répond en reply au message de commande
 * @param {Object} message - Message Discord
 */
export async function execute(message) {
    const dresseurId = message.author.id;
    const ballsAvailable = await bddService.getBallsForUser(message.guildId, dresseurId);
    
    const ballConfigs = Object.entries(getConfig().balls);
    let toPrint = "🎒 Ce qui se trouve dans tes poches : \n";
    toPrint += ballConfigs.map(([ballType, ball], index) => `${ball.nom ?? ballType} : ${ballsAvailable[index]}`).join("\n");
    
    await channelService.replySafe(message, toPrint);
}

// Metadata pour l'aide automatique
export const metadata = {
    name: 'balls',
    description: 'Affiche ton inventaire de balls',
    usage: '!balls',
    category: 'Pokémon'
};
