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
 * Lock du Pokémon actuellement prêt à être capturé (spawn actif)
 * 1 si le Pokémon est lock
 * 0 si le Pokémon est disponible
 * null si aucun Pokémon n'est disponible
 * @type {number|null}
 */
export let _lockPkmAvailable = null;

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

/**
 * Retourne l'état du lock du Pokémon disponible à la capture
 * @returns {number|null} - 1 si verrouillé, 0 si disponible, null si aucun spawn actif
 */
export function getLockPkmAvailable() {
    return _lockPkmAvailable;
}

/**
 * Définit l'état du lock du Pokémon disponible à la capture
 * @param {number|null} value 1 pour verrouiller, 0 pour libérer,
 *        null s'il n'y a pas de spawn actif
 */
export function setLockPkmAvailable(value) {
    _lockPkmAvailable = value;
}

/**
 * Dresseurs ayant déjà tenté de capturer le Pokémon disponible (spawn actif)
 * IDs Discord des dresseurs ; vide si personne n'a tenté ou si aucun
 * Pokémon n'est disponible.
 * À vider à chaque nouveau spawn : setTentativesCapture(new Set())
 * @type {Set<string>}
 */
export let _tentativesCapture = new Set();

/**
 * Retourne la liste des dresseurs ayant déjà tenté une capture
 * sur le Pokémon disponible (spawn actif)
 * @returns {Set<string>} - IDs Discord des dresseurs ayant déjà tenté
 */
export function getTentativesCapture() {
    return _tentativesCapture;
}

/**
 * Remplace la liste des dresseurs ayant déjà tenté une capture
 * sur le Pokémon disponible
 * @param {Set<string>} value - Nouvelle liste d'IDs Discord ;
 * passer new Set() pour la vider (à faire à chaque nouveau spawn)
 * @throws {TypeError} - Si value n'est pas un Set
 */
export function setTentativesCapture(value) {
    if (!(value instanceof Set)) {
        throw new TypeError(`setTentativesCapture attend un Set, reçu : ${value}`);
    }
    _tentativesCapture = value;
}

/**
 * Ajoute un dresseur à la liste des tentatives de capture
 * sur le Pokémon disponible (spawn actif)
 * Sans effet s'il y figure déjà : le Set ignore les doublons
 * @param {string} userId - ID Discord du dresseur
 */
export function addTentativesCapture(userId) {
    _tentativesCapture.add(userId);
}

/**
 * Vide la liste des tentatives de capture
 * À appeler à chaque nouveau spawn : les dresseurs ayant tenté sur le
 * Pokémon précédent ne doivent pas être marqués pour le suivant
 */
export function clearTentativesCapture() {
    setTentativesCapture(new Set());
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
