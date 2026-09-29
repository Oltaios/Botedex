/**
 * Commande !help
 * Affiche la liste des commandes disponibles, générée depuis les metadata
 *
 * Exemple d'utilisation :
 *   import { execute } from './commands/help.js';
 *   await execute(message);
 */

import { getAllCommands } from './index.js';

/**
 * Exécute la commande !help
 * @param {Object} message - Message Discord (messageCreate)
 */
export async function execute(message) {
    const commands = getAllCommands();

    // Regroupe les commandes par catégorie, en conservant l'ordre de déclaration
    const byCategory = new Map();
    for (const cmd of commands) {
        if (!byCategory.has(cmd.category)) {
            byCategory.set(cmd.category, []);
        }
        byCategory.get(cmd.category).push(cmd);
    }

    let help = "**Voici les commandes disponibles :**\n";
    for (const [category, cmds] of byCategory) {
        help += `\n**${category}**\n`;
        for (const cmd of cmds) {
            help += `- \`${cmd.usage}\` : ${cmd.description}${cmd.adminOnly ? ' *(réservée aux admins)*' : ''}\n`;
        }
    }
    help += "\nPas encore de compte ? `!jeVeuxJouerStpCreeMoiUnComptePourquoiCetteCommandeEstSiLongueJeHaisLesDevs`";

    await message.reply(help);
}

// Metadata pour l'aide automatique
export const metadata = {
    name: 'help',
    description: 'Affiche la liste des commandes disponibles',
    usage: '!help',
    category: 'Utilitaires'
};
