/**
 * Gestionnaire de l'événement 'messageReactionAdd' (réaction ajoutée à un message)
 * Utilisé par le mini-jeu "ability" : le bot pose 4 réactions (1️⃣-4️⃣) sur son
 * message de quiz et le joueur clique sur celle de sa réponse.
 *
 * Ne traite que les réactions sur les messages du bot dans le channel principal ;
 * le filtrage fin (session active, bon joueur, bonne emoji) est fait par
 * GameService.handleReaction().
 *
 * Exemple d'utilisation :
 *   import { handle } from './events/messageReactionAdd.js';
 *   client.on('messageReactionAdd', handle);
 */

import { client } from '../core/client.js';
import { channelService } from '../services/channel/ChannelService.js';
import { gameService } from '../services/game/GameService.js';

/**
 * Gère l'événement 'messageReactionAdd' de Discord
 * @param {Object} reaction - Réaction ajoutée (discord.js MessageReaction)
 * @param {Object} user - Utilisateur ayant réagi
 * @returns {Promise<void>}
 */
export async function handle(reaction, user) {
    try {
        // Ignore les réactions du bot lui-même (les 4 emojis qu'il pose)
        if (!user || user.id === client.user.id || user.bot) return;
        // Channel principal uniquement
        if (reaction.message?.channel?.id !== channelService.channelId) return;
        // Uniquement les messages envoyés par le bot (le quiz y pose ses réactions)
        if (reaction.message?.author?.id !== client.user.id) return;

        await gameService.handleReaction(reaction, user);
    } catch (error) {
        console.error('❌ Erreur lors du traitement de la réaction :', error);
    }
}
