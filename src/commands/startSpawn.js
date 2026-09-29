/**
 * Commande !startSpawn
 * Démarre les spawns automatiques de Pokémon (admin seulement)
 * 
 * Exemple d'utilisation :
 *   import { execute } from './commands/startSpawn.js';
 *   await execute(message, channel);
 */

import { spawnService } from '../services/game/SpawnService.js';
import { channelService } from '../services/channel/ChannelService.js';

/**
 * Exécute la commande !startSpawn
 * Répond en reply au message de commande
 * @param {Object} message - Message Discord
 */
export async function execute(message) {
    // Vérifie si l'utilisateur est admin (oltaios)
    if (message.author.username !== 'oltaios') {
        await channelService.replySafe(message, "Tu n'as pas les droits pour exécuter cette commande.");
        return;
    }

    await channelService.replySafe(message, "Demande de démarrage des spawn en cours");
    spawnService.startSpawn(message.channel);
    await channelService.replySafe(message, "Demande de démarrage des spawn terminée");
}

// Metadata pour l'aide automatique
export const metadata = {
    name: 'startSpawn',
    description: 'Démarre les spawns automatiques de Pokémon',
    usage: '!startSpawn',
    category: 'Admin',
    adminOnly: true
};
