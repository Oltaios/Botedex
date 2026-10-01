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
 *   const started = await workService.startWork(idDiscord);
 */

import { bddService } from '../bdd/BDDService.js';
import { moneyService } from './MoneyService.js';
import { getConfig } from '../../utils/configLoader.js';
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
     * @param {string} userId - ID Discord du dresseur
     * @returns {Promise<boolean>} - true si le dresseur a pu partir travailler, false s'il travaille déjà
     */
    async startWork(userId, message) {
        const canWork = await bddService.userGoToWork(userId);
        if (canWork !== 0) {
            return false;
        }

        // Termine la session après la durée de travail
        setTimeout(() => {
            this.finishWork(userId).catch(console.error);
            channelService.replySafe(message, "Travail terminé ! (à lire avec une voix de peon si t'es assez vieux)")
        }, WORK_DURATION_MS);

        return true;
    }

    /**
     * Retourne l'heure de fin de session de travail d'un dresseur
     * (heure de début enregistrée + durée de session), au format timestamp
     * Unix en secondes, directement exploitable dans un formatage Discord
     * <t:...:R> (compte à rebours relatif affiché par le client)
     * @param {string} userId - ID Discord du dresseur
     * @returns {Promise<number|null>} - Timestamp de fin en secondes, ou
     *          null si le dresseur n'a pas de session enregistrée
     */
    async getWorkEndTimestamp(userId) {
        const startTime = await bddService.getStartWorkTimeUser(userId);
        if (startTime === null) {
            return null;
        }
        return Math.floor((startTime + WORK_DURATION_MS) / 1000);
    }

    /**
     * Termine une session de travail : verse la paye et libère le dresseur
     * Les deux mises à jour sont atomiques ($inc / $set ciblés), sans
     * réécriture du document complet
     * @param {string} userId - ID Discord du dresseur
     * @returns {Promise<number>} - Montant de la récompense versée
     */
    async finishWork(userId) {
        const reward = this.getWorkReward();
        await moneyService.gainMoney(userId, reward);
        await bddService.updateOneFieldForOneUser(userId, 'isWorking', 0);
        return reward;
    }

    /**
     * Réinitialise le statut de travail de tous les dresseurs
     * À appeler au démarrage du bot : les sessions planifiées par startWork
     * sont perdues lors d'un redémarrage, il faut donc libérer les dresseurs
     * @returns {Promise<void>}
     */
    async resetAllWork() {
        await bddService.resetIsWorking();
    }
}

export const workService = new WorkService();
