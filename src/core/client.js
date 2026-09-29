/**
 * Client Discord principal
 * Centralise la création du client et les variables globales
 * 
 * Exemple d'utilisation :
 *   import { client, pendingResponses } from './core/client.js';
 */

import 'dotenv/config';
import Discord from 'discord.js';

// Client Discord (Singleton)
const client = new Discord.Client({
    intents: [
        Discord.GatewayIntentBits.GuildMessages,
        Discord.GatewayIntentBits.Guilds,
        Discord.GatewayIntentBits.MessageContent
    ]
});

/**
 * Clés d'utilisateurs ayant une réponse en attente d'un collector
 * Format des clés : "<channelId>:<userId>" ou "capture-<userId>"
 * Utilisé par messageCreate pour ignorer les messages d'un joueur
 * pendant qu'il répond à une commande interactive (!shop, !gif, !game, !capture)
 * @type {Set<string>}
 */
export const pendingResponses = new Set();

/**
 * Numéro du Pokémon actuellement prêt à être capturé (spawn actif)
 * null si aucun Pokémon n'est disponible
 * @type {number|null}
 */
export let _numPkmAvailable = null;

/**
 * Retourne le numéro du Pokémon disponible à la capture
 * @returns {number|null} - Numéro du Pokémon, ou null si aucun spawn actif
 */
export function getNumPkmAvailable() {
    return _numPkmAvailable;
}

/**
 * Définit le Pokémon disponible à la capture
 * Appelé par SpawnService lors d'un spawn et par CaptureService à la fin d'une capture
 * @param {number|null} value - Numéro du Pokémon, ou null pour vider le spawn
 */
export function setNumPkmAvailable(value) {
    _numPkmAvailable = value;
}

// État global de la commande capture
let captureCommandActive = false;

/**
 * Retourne l'état de la commande capture (true si une capture est en cours)
 * @returns {boolean}
 */
export function isCaptureCommandActive() {
    return captureCommandActive;
}

/**
 * Définit l'état de la commande capture
 * @param {boolean} active - Nouveau état
 */
export function setCaptureCommandActive(active) {
    captureCommandActive = active;
}

// Exporte le client
if (!process.env.DISCORD_TOKEN) {
    console.error('❌ DISCORD_TOKEN manquant : renseigne-le dans le fichier .env');
    process.exit(1);
}
const token = process.env.DISCORD_TOKEN;

export { client, token };
