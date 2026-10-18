/**
 * Commande !egg
 * Gère l'œuf du dresseur : "!egg" affiche l'état d'éclosion (flou, le
 * décompte des captures est caché), "!egg obtenir" confie un œuf au
 * dresseur (un seul en incubation à la fois). L'œuf éclos après
 * egg.capturesRequises captures réussies, sans commande : le Pokémon
 * qui en sort est annoncé dans le flux de capture.
 *
 * Exemple d'utilisation :
 *   import { execute } from './commands/egg.js';
 *   await execute(message);
 */

import { eggService } from '../services/egg/EggService.js';
import { channelService } from '../services/channel/ChannelService.js';

/**
 * Exécute la commande !egg
 * L'action est le texte éventuel qui suit "!egg" (ex: "!egg obtenir") ;
 * sans action, affiche l'état de l'œuf
 * @param {Object} message - Message Discord ayant déclenché la commande
 * @returns {Promise<void>}
 */
export async function execute(message) {
    const action = message.content.slice('!egg'.length).trim().toLowerCase() || null;
    const { guildId, author } = message;

    if (action === 'obtenir') {
        const confie = await eggService.donnerOeuf(guildId, author.id);
        await channelService.replySafe(
            message,
            confie
                ? "🥚 Le Professeur Chen te confie un œuf ! Continue de capturer, il finira bien par éclorer..."
                : "Tu as déjà un œuf en incubation ! File capturer, il n'éclosira pas tout seul."
        );
        return;
    }

    if (action === null) {
        const etat = await eggService.getEtatOeuf(guildId, author.id);
        if (etat === null) {
            await channelService.replySafe(
                message,
                "Tu n'as pas d'œuf ! **!egg obtenir** pour que le Professeur Chen t'en confie un."
            );
        } else {
            await channelService.replySafe(message, `🥚 ${etat}`);
        }
        return;
    }

    await channelService.replySafe(
        message,
        "Action inconnue. Essaie **!egg** (état de ton œuf) ou **!egg obtenir** (récupérer un œuf)."
    );
}

// Metadata pour l'aide automatique
export const metadata = {
    name: 'egg',
    description: "Gère ton œuf : état d'éclosion (progression cachée) et obtention d'un nouvel œuf",
    usage: '!egg [obtenir]',
    category: 'Pokémon'
};
