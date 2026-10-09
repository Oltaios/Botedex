/**
 * Commande !casino
 * Casino clandestin de la Team Rocket : le joueur mise entre
 * casino.minBet et casino.maxBet, un lot est tiré selon la table
 * casino.payouts (espérance négative : sink d'argent volontaire)
 *
 * Exemple d'utilisation :
 *   import { execute } from './commands/casino.js';
 *   await execute(message, pendingResponses);
 */

import { bddService } from '../services/bdd/BDDService.js';
import { casinoService } from '../services/economy/CasinoService.js';
import { pendingResponses } from '../core/client.js';
import { channelService } from '../services/channel/ChannelService.js';

/**
 * Formate une probabilité en pourcentage à la française (0.005 -> "0,5%")
 * @param {number} chance - Probabilité entre 0 et 1
 * @returns {string}
 */
function formatPercent(chance) {
    return `${String(chance * 100).replace('.', ',')}%`;
}

/**
 * Extrait la mise d'un message au format "!<nombre>" ou "<nombre>"
 * @param {string} content - Contenu du message Discord
 * @returns {number|null} - Mise saisie, ou null si le format est invalide
 */
function parseBet(content) {
    const match = content.trim().match(/^!?\s*(\d+)\s*$/);
    return match ? parseInt(match[1], 10) : null;
}

/**
 * Exécute la commande !casino
 * Affiche les règles et la table des lots, attend 15 s une mise au format
 * "!<montant>" (ex: "!50"), règle le pari de façon atomique et annonce le
 * résultat. Une seule tentative par lancement.
 * @param {Object} message - Message Discord ayant déclenché la commande
 * @param {Set<string>} pendingResponses - Clés des réponses en attente (pour ignorer les messages du joueur pendant l'attente)
 * @returns {Promise<void>}
 */
export async function execute(message, pendingResponses) {
    const currentUserId = message.author.id;
    const responseKey = `${message.channel.id}:${message.author.id}`;

    // Marque l'utilisateur comme "en attente de réponse"
    pendingResponses.add(responseKey);

    const moneyAvailable = await bddService.getMoneyForUser(message.guildId, currentUserId);
    const minBet = casinoService.getMinBet();
    const maxBet = casinoService.getMaxBet();

    // Règles et table des lots regroupées dans un seul reply
    let messageCasino = "🎰 **Bienvenue au Casino clandestin de la Team Rocket !**\n\n";
    messageCasino += `💰 Tu as ${moneyAvailable}$\n`;
    messageCasino += `Entre ta mise (entre ${minBet}$ et ${maxBet}$) et croise les doigts : la machine encaisse toujours plus qu'elle ne paie...\n\n`;
    messageCasino += "🏆 **Table des lots :**\n";
    casinoService.getPayouts().forEach(payout => {
        messageCasino += `${payout.label} → gain x${payout.multiplier}\n`;
    });
    messageCasino += "\nFormat de réponse attendu : `!<montant>` (ex: `!50` pour miser 50$)";
    await channelService.replySafe(message, messageCasino);

    // Crée le collector pour la mise
    const filter = m => m.author.id === currentUserId && parseBet(m.content) !== null;

    const collector = message.channel.createMessageCollector({
        filter,
        max: 1,
        time: casinoService.getResponseTimeMs()
    });

    collector.on('collect', async collected => {
        const bet = parseBet(collected.content);

        // Validation de la mise contre les bornes de la config
        const validation = casinoService.validateBet(bet);
        if (!validation.valid) {
            await channelService.replySafe(message, `Mise refusée : il faut ${validation.reason}. La Team Rocket ne fait pas crédit.`);
            return;
        }

        // Tirage et règlement atomique (mise débitée, gain crédité en un seul $inc)
        const result = await casinoService.play(message.guildId, currentUserId, bet);

        if (!result.settled) {
            await channelService.replySafe(message, `Solde insuffisant au moment d'encaisser les ${bet}$. La Team Rocket ne fait pas crédit, déguerpis !`);
            return;
        }

        let messageResult;
        if (result.gain === 0) {
            messageResult = `💀 **${result.payout.label} !** Tes ${bet}$ partent directement dans la caisse noire de la Team Rocket. Jesse et James te remercient pour ta contribution.`;
        } else if (result.payout.multiplier === 1) {
            messageResult = `😐 **${result.payout.label} !** Tu repars avec ta mise de ${bet}$. La machine te nargue, retente ta chance si tu aimes perdre.`;
        } else {
            messageResult = `🎉 **${result.payout.label} !** ${bet}$ misés → ${result.gain}$ gagnés (x${result.payout.multiplier}). La Team Rocket grince des dents, mais tient parole.`;
        }
        await collected.reply(`${messageResult}\nSolde restant : ${result.balance}$`);
    });

    collector.on('end', () => {
        if (collector.endReason === 'time') {
            channelService.replySafe(message, "Un grand gaillard t'attrape par le colbac et te fout dehors, fallait miser plus vite... (Sortie du casino)");
        }
        pendingResponses.delete(responseKey); // Libère la clé
    });
}

// Metadata pour l'aide automatique
export const metadata = {
    name: 'casino',
    description: 'Mise de l\'argent au casino clandestin de la Team Rocket (à tes risques et périls)',
    usage: '!casino',
    category: 'Économie'
};
