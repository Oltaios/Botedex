/**
 * Index des commandes
 * Centralise l'export de toutes les commandes
 *
 * Exemple d'utilisation :
 *   import * as commands from './commands/index.js';
 *   await commands.ping.execute(message);
 */

import * as ping from './ping.js';
import * as capture from './capture.js';
import * as shop from './shop.js';
import * as game from './game.js';
import * as work from './work.js';
import * as money from './money.js';
import * as balls from './balls.js';
import * as pokedex from './pokedex.js';
import * as casino from './casino.js';
import * as help from './help.js';
import * as admin from './admin.js';

export { ping, capture, shop, game, work, money, balls, pokedex, casino, help, admin };

/**
 * Liste toutes les commandes disponibles
 * @returns {Array<Object>} - Tableau des métadonnées des commandes
 */
export function getAllCommands() {
    return [
        ping.metadata,
        capture.metadata,
        shop.metadata,
        game.metadata,
        work.metadata,
        money.metadata,
        balls.metadata,
        pokedex.metadata,
        casino.metadata,
        help.metadata,
        admin.metadata
    ];
}
