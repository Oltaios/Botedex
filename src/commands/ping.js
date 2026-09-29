/**
 * Commande !ping
 * Vérifie que le bot est en ligne et répond avec la latence
 * 
 * Exemple d'utilisation :
 *   import { execute } from './commands/ping.js';
 *   await execute(message);
 */

/**
 * Exécute la commande !ping
 * Répond en reply au message de commande
 * @param {Object} message - Message Discord (messageCreate)
 */
export async function execute(message) {
    await message.reply('Pong.');
}

// Metadata pour l'aide automatique (optionnel)
export const metadata = {
    name: 'ping',
    description: 'Vérifie que le bot est en ligne',
    usage: '!ping',
    category: 'Utilitaires'
};
