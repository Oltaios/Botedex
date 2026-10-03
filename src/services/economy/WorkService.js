/**
 * Service de gestion du travail
 * Responsabilité : cycle complet d'une session de travail — départ
 * (verrouillage du dresseur), durée (1 h, via setTimeout), fin (versement
 * de la paye via MoneyService et libération du dresseur).
 *
 * Limitation : la fin de session est planifiée en mémoire (setTimeout),
 * elle est donc perdue au redémarrage du bot ; resetAllWork() libère
 * les dresseurs bloqués au démarrage (la paye est perdue).
 *
 * Exemple d'utilisation :
 *   import { workService } from './services/economy/WorkService.js';
 *   const started = await workService.startWork(guildId, idDiscord, message);
 */

import { bddService } from '../bdd/BDDService.js';
import { moneyService } from './MoneyService.js';
import { getConfig, getDiscordGuildId } from '../../utils/configLoader.js';
import { channelService } from '../channel/ChannelService.js';

// Durée d'une session de travail (1 heure)
const WORK_DURATION_MS = 60 * 60 * 1000;

export class WorkService {
    constructor() {
        this.config = getConfig();
    }

    /**
     * Retourne la récompense d'une session de travail (depuis gameConfig.json)
     * @returns {number}
     */
    getWorkReward() {
        return this.config.economy.workReward;
    }

    /**
     * Fait partir un dresseur au travail
     * Planifie automatiquement la fin de la session (WORK_DURATION_MS) et
     * le versement de la paye
     * @param {string} guildId - ID du serveur Discord (isolation des données)
     * @param {string} userId - ID Discord du dresseur
     * @param {Object} message - Message Discord de la commande (message de fin)
     * @returns {Promise<boolean>} - true si le dresseur a pu partir travailler, false s'il travaille déjà
     */
    async startWork(guildId, userId, message) {
        const canWork = await bddService.userGoToWork(guildId, userId);
        if (canWork !== 0) {
            return false;
        }

        // Termine la session après la durée de travail
        setTimeout(() => {
            this.finishWork(guildId, userId).catch(console.error);
            channelService.replySafe(message, "Travail terminé ! (à lire avec une voix de peon si t'es assez vieux)")
        }, WORK_DURATION_MS);

        return true;
    }

    /**
     * Retourne l'heure de fin de session de travail d'un dresseur
     * (heure de début enregistrée + durée de session), au format timestamp
     * Unix en secondes, directement exploitable dans un formatage Discord
     * <t:...:R> (compte à rebours relatif affiché par le client)
     * @param {string} guildId - ID du serveur Discord (isolation des données)
     * @param {string} userId - ID Discord du dresseur
     * @returns {Promise<number|null>} - Timestamp de fin en secondes, ou
     *          null si le dresseur n'a pas de session enregistrée
     */
    async getWorkEndTimestamp(guildId, userId) {
        const startTime = await bddService.getStartWorkTimeUser(guildId, userId);
        if (startTime === null) {
            return null;
        }
        return Math.floor((startTime + WORK_DURATION_MS) / 1000);
    }

    /**
     * Termine une session de travail : verse la paye et libère le dresseur
     * Les deux mises à jour sont atomiques ($inc / $set ciblés), sans
     * réécriture du document complet
     * @param {string} guildId - ID du serveur Discord (isolation des données)
     * @param {string} userId - ID Discord du dresseur
     * @returns {Promise<number>} - Montant de la récompense versée
     */
    async finishWork(guildId, userId) {
        const reward = this.getWorkReward();
        await moneyService.gainMoney(guildId, userId, reward);
        await bddService.updateOneFieldForOneUser(guildId, userId, 'isWorking', 0);
        return reward;
    }

    /**
     * Réinitialise le statut de travail des dresseurs du serveur de cette
     * instance (DISCORD_GUILD_ID). À appeler au démarrage du bot : les
     * sessions planifiées par startWork sont perdues lors d'un redémarrage,
     * il faut donc libérer les dresseurs. Le filtre par serveur évite qu'une
     * instance ne libère les dresseurs suivis par une autre instance (base
     * commune). Sans DISCORD_GUILD_ID, s'applique à toutes les guilds.
     * @returns {Promise<void>}
     */
    async resetAllWork() {
        const guildId = getDiscordGuildId();
        if (!guildId) {
            console.warn('⚠️ DISCORD_GUILD_ID non défini : reset du travail appliqué à toutes les guilds');
        }
        await bddService.resetIsWorking(guildId);
    }
}

export const workService = new WorkService();
