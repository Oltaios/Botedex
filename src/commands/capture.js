/**
 * Commande !capture
 * Lance une tentative de capture de Pokémon
 * 
 * Exemple d'utilisation :
 *   import { execute } from './commands/capture.js';
 *   await execute(message, pendingResponses);
 */

import { captureService } from '../services/capture/CaptureService.js';
import { pendingResponses } from '../core/client.js';
import { channelService } from '../services/channel/ChannelService.js';

/**
 * Exécute la commande !capture (réservée à oltaios tant que la fonctionnalité est en test)
 * Délègue tout le flux à CaptureService.gererEventCapture()
 * @param {Object} message - Message Discord ayant déclenché la commande
 * @returns {Promise<void>}
 */
export async function execute(message) {
    if (!metadata.adminOnly) {
        const responseKey = `capture-${message.author.id}`;
        console.log("Appel de capture.js ajout de responseKey : " + responseKey);
        pendingResponses.add(responseKey);
        await captureService.gererEventCapture(message, responseKey);
    } else {
        await channelService.replySafe(message, "Commande réservée à oltaios pour l'instant.");
    }
}

// Metadata pour l'aide automatique
export const metadata = {
    name: 'capture',
    description: 'Lance une tentative de capture de Pokémon',
    usage: '!capture',
    category: 'Pokémon',
    adminOnly: false
};
