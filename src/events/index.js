/**
 * Index des gestionnaires d'événements
 * Centralise l'export de tous les événements Discord
 * 
 * Exemple d'utilisation :
 *   import { ready, messageCreate } from './events/index.js';
 *   client.once('ready', ready.handle);
 *   client.on('messageCreate', messageCreate.handle);
 */

import * as messageCreate from './messageCreate.js';

/**
 * Enregistre tous les événements sur un client Discord
 * @param {Object} client - Client Discord
 */
export function registerAllEvents(client) {
    // Événement 'messageCreate' (à chaque nouveau message)
    client.on('messageCreate', messageCreate.handle);

    // TODO: Ajouter d'autres événements si nécessaire
    // Exemple: client.on('interactionCreate', interactionCreate.handle);

    console.log('✅ Tous les événements Discord enregistrés');
}
