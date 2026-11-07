/**
 * Commande !event
 * Affiche la progression de l'événement quotidien collaboratif (thème
 * Team Rocket) : barre de progression, points totaux/objectif, joueurs
 * actifs, points personnels et heure du prochain reset.
 *
 * Exemple d'utilisation :
 *   import { execute } from './commands/event.js';
 *   await execute(message);
 */

import { dailyEventService } from '../services/event/DailyEventService.js';
import { channelService } from '../services/channel/ChannelService.js';

/**
 * Exécute la commande !event
 * Répond en reply au message de commande
 * @param {Object} message - Message Discord
 */
export async function execute(message) {
    const status = await dailyEventService.getStatus(message.guildId, message.author.id);
    const pct = Math.round(status.ratio * 100);
    const resetTs = Math.floor(status.nextReset.getTime() / 1000);
    const msg =
        `🚀 **Événement quotidien — la Team Rocket a volé des Pokémon, défendez-les !**\n` +
        `${status.bar} ${pct}% — **${status.totalPoints}/${status.goal} points**\n` +
        `Joueurs actifs (24h) : **${status.activeCount}** (objectif : ${dailyEventService.pointsPerActivePlayer} pts × joueurs actifs)\n` +
        `Tes points : **${status.myPoints}** — statut : ${status.isActive ? 'actif ✅' : 'inactif ❌'}\n` +
        (status.completed
            ? `✅ Événement terminé ! Chaque joueur actif a reçu **${dailyEventService.rewardAmount}$**.\n`
            : `À la complétion, chaque joueur actif reçoit **${dailyEventService.rewardAmount}$** (capture = ${dailyEventService.points.capture} pts, jeu = ${dailyEventService.points.game} pts, travail = ${dailyEventService.points.work} pts).\n`) +
        `Reset quotidien à ${dailyEventService.resetHour}h00 (<t:${resetTs}:R>)`;
    await channelService.replySafe(message, msg);
}

// Metadata pour l'aide automatique
export const metadata = {
    name: 'event',
    description: "Progression de l'événement quotidien collaboratif (Team Rocket)",
    usage: '!event',
    category: 'Événement'
};
