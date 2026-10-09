/**
 * Commande !admin
 * Commandes d'administration, réservées aux ID Discord listés dans
 * admin.adminUserIds (gameConfig.json, chaîne d'IDs séparés par des
 * virgules ; la variable d'environnement ADMIN_USER_IDS prime si définie).
 *
 * Sous-commandes :
 *   !admin stopWork : arrête tous les dresseurs au travail (isWorking = 1)
 *                     et les paie au prorata du temps travaillé
 *   !admin stats : statistiques des joueurs du serveur (argent accumulé,
 *                  balls achetées, échecs de capture, mises au casino)
 *
 * Exemple d'utilisation :
 *   import { execute } from './commands/admin.js';
 *   await execute(message);
 */

import { getAdminUserIds } from '../utils/configLoader.js';
import { bddService } from '../services/bdd/BDDService.js';
import { workService } from '../services/economy/WorkService.js';
import { channelService } from '../services/channel/ChannelService.js';

/**
 * Vérifie si l'auteur du message est un administrateur du bot
 * @param {Object} message - Message Discord
 * @returns {boolean}
 */
function isAdmin(message) {
    return getAdminUserIds().includes(message.author.id);
}

/**
 * Exécute la sous-commande !admin stopWork
 * Libère tous les dresseurs au travail du serveur et les paie au prorata
 * @param {Object} message - Message Discord
 * @returns {Promise<void>}
 */
async function executeStopWork(message) {
    const results = await workService.stopAllWork(message.guildId);

    if (results.length === 0) {
        await channelService.replySafe(message, "Personne n'est au travail, le chantier est désert. Difficile de virer des absents...");
        return;
    }

    let messageStop = `🛑 Chantier fermé sur décision patronale ! ${results.length} dresseur(s) renvoyé(s), payés au prorata du temps de labeur :\n`;
    let total = 0;
    for (const worker of results) {
        total += worker.reward;
        const duree = worker.elapsedMs > 0
            ? `${Math.round(worker.elapsedMs / 60000)} min`
            : 'durée inconnue';
        messageStop += `- ${worker.name ?? worker.userId} : ${worker.reward}$ (${duree})\n`;
    }
    messageStop += `Total versé : ${total}$`;
    await channelService.replySafe(message, messageStop);
}

/**
 * Exécute la sous-commande !admin stats
 * Affiche les statistiques agrégées du serveur (argent accumulé, balls
 * achetées, échecs de capture, mises de casino) puis le top des joueurs
 * par argent accumulé
 * @param {Object} message - Message Discord
 * @returns {Promise<void>}
 */
async function executeStats(message) {
    const stats = await bddService.getStatsDresseurs(message.guildId);
    const top = await bddService.getTopDresseurs(message.guildId, 5);

    let messageStats = `📊 **Stats des dresseurs du serveur** (${stats.dresseurs} joueur(s)) :\n`;
    messageStats += `- 💰 Argent accumulé (gains bruts) : ${stats.argentGagne}$\n`;
    messageStats += `- 🛒 Balls achetées : ${stats.ballsAchetees}\n`;
    messageStats += `- 🎯 Échecs de capture : ${stats.capturesEchouees}\n`;
    messageStats += `- 🎰 Argent misé au casino : ${stats.argentMise}$\n`;
    messageStats += `- 🪙 Argent en circulation : ${stats.argentEnCirculation}$\n`;
    if (top.length > 0) {
        messageStats += `\n🏆 **Top ${top.length} par argent accumulé** :\n`;
        top.forEach((dresseur, index) => {
            messageStats += `${index + 1}. ${dresseur.name ?? dresseur.userId} — ${dresseur.argentGagne ?? 0}$ gagnés, ${dresseur.ballsAchetees ?? 0} balls achetées, ${dresseur.capturesEchouees ?? 0} échec(s), ${dresseur.argentMise ?? 0}$ misés\n`;
        });
    }
    await channelService.replySafe(message, messageStats);
}

/**
 * Exécute la commande !admin
 * @param {Object} message - Message Discord
 * @returns {Promise<void>}
 */
export async function execute(message) {
    if (!isAdmin(message)) {
        await channelService.replySafe(message, "Cette commande est réservée aux admins. La sécurité t'escorte jusqu'à la sortie.");
        return;
    }

    const args = message.content.trim().split(/\s+/);
    const action = (args[1] ?? '').toLowerCase();

    switch (action) {
        case 'stopwork':
            await executeStopWork(message);
            break;
        case 'stats':
            await executeStats(message);
            break;
        case '':
            await channelService.replySafe(message, "Actions admin disponibles :\n- `!admin stopWork` : arrête tous les chantiers et paie les travailleurs au prorata\n- `!admin stats` : statistiques des joueurs (argent accumulé, balls achetées, échecs de capture, mises au casino)");
            break;
        default:
            await channelService.replySafe(message, `Action admin inconnue : \`${action}\`. Le problème semble se situer entre la chaise et le clavier, à bon entendeur...`);
            break;
    }
}

// Metadata pour l'aide automatique
export const metadata = {
    name: 'admin',
    description: 'Commandes d\'administration (arrêt des chantiers, etc.)',
    usage: '!admin <action>',
    category: 'Admin',
    adminOnly: true
};
