/**
 * Commande !game
 * Lance un mini-jeu : "!game <type>" directement (ex: "!game type") ou
 * "!game" seul puis "!<type>" pour choisir le jeu en différé
 * 
 * Exemple d'utilisation :
 *   import { execute } from './commands/game.js';
 *   await execute(message);
 */

import { gameService } from '../services/game/GameService.js';

/**
 * Exécute la commande !game
 * Délègue tout le flux à GameService.startGame() : le type de jeu est le
 * texte éventuel qui suit "!game" (ex: "!game type" -> 'type') ; s'il est
 * absent, le choix du jeu se fera en différé via "!<type>"
 * @param {Object} message - Message Discord ayant déclenché la commande
 * @returns {Promise<void>}
 */
export async function execute(message) {
    const gameType = message.content.slice('!game'.length).trim().toLowerCase() || null;
    await gameService.startGame(message, gameType);
}

// Metadata pour l'aide automatique
export const metadata = {
    name: 'game',
    description: 'Lance un mini-jeu : !game type (deviner le type) ou !game weight (deviner le poids d\'un Pokémon)',
    usage: '!game [type|weight]',
    category: 'Jeux'
};
