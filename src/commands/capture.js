/**
 * Commande !capture
 * Lance une tentative de capture de Pokémon
 * 
 * Exemple d'utilisation :
 *   import { execute } from './commands/capture.js';
 *   await execute(message, pendingResponses);
 */

import { captureService } from '../services/capture/CaptureService.js';
import { pendingResponses, getLockPkmAvailable, setLockPkmAvailable, getTentativesCapture } from '../core/client.js';
import { channelService } from '../services/channel/ChannelService.js';

/**
 * Exécute la commande !capture (réservée à oltaios tant que la fonctionnalité est en test)
 * Délègue tout le flux à CaptureService.gererEventCapture()
 * @param {Object} message - Message Discord ayant déclenché la commande
 * @returns {Promise<void>}
 */
export async function execute(message) {
    if (!metadata.adminOnly) {

        if(getTentativesCapture() !== null && getTentativesCapture().has(message.author.id)){
            await channelService.replySafe(message, "C'est le genre d'occasion qu'on a qu'une seule fois dans une vie, tu décides de laisser la place aux autres...");
            return;
        }

        // Un seul flux de capture à la fois sur le spawn actif
        if (getLockPkmAvailable() === 1) {
            await channelService.replySafe(message, "Tu t'apprêtes à saisir ta plus belle pokéball mais il semblerait que quelqu'un ait été plus rapide que toi...");
            return;
        }
        setLockPkmAvailable(1);

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
