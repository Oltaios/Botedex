/**
 * Commande !capture
 * Lance une tentative de capture de Pokémon
 * "!capture <ball>" tente directement la capture avec la ball choisie,
 * "!capture" seul laisse le service demander la ball à utiliser
 *
 * Exemple d'utilisation :
 *   import { execute } from './commands/capture.js';
 *   await execute(message, pendingResponses);
 */

import { captureService } from '../services/capture/CaptureService.js';
import { pendingResponses, getLockPkmAvailable, setLockPkmAvailable, getTentativesCapture, getNumPkmAvailable } from '../core/client.js';
import { channelService } from '../services/channel/ChannelService.js';

/**
 * Exécute la commande !capture
 * Délègue tout le flux à CaptureService.gererEventCapture() : le type de
 * ball éventuellement passé en argument ("!capture pokeball") est extrait
 * du message, absent signifie que la ball sera demandée à l'utilisateur
 * @param {Object} message - Message Discord ayant déclenché la commande
 * @returns {Promise<void>}
 */
export async function execute(message) {
    if (!metadata.adminOnly) {

        if(getTentativesCapture() !== null && getTentativesCapture().has(message.author.id) && getNumPkmAvailable !== null){
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
        // Raccourci "!capture <ball>" : type de ball éventuel après la commande
        const ballType = message.content.slice('!capture'.length).trim().toLowerCase() || null;
        await captureService.gererEventCapture(message, responseKey, ballType);
    } else {
        await channelService.replySafe(message, "Commande réservée à oltaios pour l'instant.");
    }
}

// Metadata pour l'aide automatique
export const metadata = {
    name: 'capture',
    description: 'Lance une tentative de capture de Pokémon (!capture pokeball pour choisir directement la ball)',
    usage: '!capture [ball]',
    category: 'Pokémon',
    adminOnly: false
};
