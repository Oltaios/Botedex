/**
 * Service de messagerie du bot
 * Responsabilité : centraliser TOUS les envois de messages Discord —
 * les messages automatiques dans le channel principal (sendMessage,
 * initialisation requise) et les réponses aux commandes des joueurs
 * (replySafe, utilisable sans initialisation).
 * Singleton : une seule instance pour toute l'application
 *
 * Initialisation REQUISE pour sendMessage :
 *   channelService.init(process.env.DISCORD_CHANNEL_ID);
 *
 * Exemple d'utilisation :
 *   import { channelService } from './services/channel/ChannelService.js';
 *   channelService.init(process.env.DISCORD_CHANNEL_ID);
 *   await channelService.sendMessage("Bonjour !");     // channel principal
 *   await channelService.replySafe(message, "Pong.");  // reply à une commande
 */

import { client } from '../../core/client.js';

export class ChannelService {
    // 👇 Champ privé pour le Singleton
    static #instance = null;
    #channel = null;       // Channel Discord fixe
    #channelId = null;     // ID du channel
    #initialized = false;   // État d'initialisation

    /**
     * Constructeur privé (Singleton)
     */
    constructor() {
        if (ChannelService.#instance) {
            return ChannelService.#instance;
        }
        ChannelService.#instance = this;
    }

    /**
     * Initialise le service avec un channel fixe
     * @param {string} channelId - ID du channel Discord
     * @throws {Error} - Si le channel est introuvable ou invalide
     */
    init(channelId) {
        if (this.#initialized) {
            console.warn("[ChannelService] Déjà initialisé. Utilisez l'instance existante.");
            return;
        }

        this.#channelId = channelId;
        this.#channel = client.channels.cache.get(channelId);

        // Vérifications
        if (!this.#channel) {
            throw new Error(`[ChannelService] Channel ${channelId} introuvable. Vérifiez :
                - L'ID est correct
                - Le bot a accès à ce serveur/channel
                - Les intents GUILD et GUILD_MESSAGES sont activés
                - Le bot est connecté (attendez l'événement 'ready')`);
        }

        if (!this.#channel.isTextBased()) {
            throw new Error(`[ChannelService] Channel ${channelId} n'est pas un channel textuel`);
        }

        this.#initialized = true;
        console.log(`✅ [ChannelService] Initialisé avec channel: ${channelId}`);
    }

    /**
     * Retourne le channel Discord
     * @returns {import('discord.js').TextChannel}
     * @throws {Error} - Si non initialisé
     */
    get channel() {
        if (!this.#initialized) {
            throw new Error("[ChannelService] Non initialisé. Appelez init(channelId) d'abord.");
        }
        return this.#channel;
    }

    /**
     * Retourne l'ID du channel
     * @returns {string|null}
     */
    get channelId() {
        return this.#channelId;
    }

    // ========== ACTIONS SUR LE CHANNEL ==========

    /**
     * Envoie un message texte
     * @param {string|Object} content - Contenu du message
     * @returns {Promise<import('discord.js').Message>}
     */
    async sendMessage(content) {
        this.#ensureInitialized();
        try {
            return await this.#channel.send(content);
        } catch (error) {
            console.error(`[ChannelService] Erreur sendMessage:`, error);
            throw error;
        }
    }

    /**
     * Répond en reply au message de commande, avec repli sur un envoi
     * direct dans son channel si le message d'origine a été supprimé
     * (fin de collector, lenteur)
     * @param {Object} message - Message Discord auquel répondre
     * @param {string} content - Contenu à envoyer
     * @returns {Promise<void>}
     */
    async replySafe(message, content) {
        try {
            await message.reply(content);
        } catch (error) {
            console.warn('[ChannelService] Reply impossible (message supprimé ?), envoi direct dans le channel :', error.message);
            await message.channel.send(content).catch(() => {});
        }
    }

        // ========== UTILITAIRES ==========

    /**
     * Vérifie que le service est initialisé
     * @private
     */
    #ensureInitialized() {
        if (!this.#initialized) {
            throw new Error("[ChannelService] Non initialisé. Appelez init(channelId) avant toute opération.");
        }
    }

}

// 👇 Exporte une instance unique (Singleton)
export const channelService = new ChannelService();