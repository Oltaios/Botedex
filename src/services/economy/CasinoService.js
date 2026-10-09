/**
 * Service du casino clandestin de la Team Rocket
 * Responsabilité : validation de la mise, tirage du lot et règlement
 * atomique du pari. Les paramètres (bornes de mise, lots et chances) sont
 * définis dans config.casino (config/gameConfig.json).
 *
 * Important : la table des lots est conçue avec une espérance de retour
 * STRICTEMENT inférieure à 1 (getExpectedReturn()) : le casino détruit de
 * l'argent à chaque mise, c'est un money sink volontaire.
 *
 * Exemple d'utilisation :
 *   import { casinoService } from './services/economy/CasinoService.js';
 *   const result = await casinoService.play(guildId, userId, 100);
 */

import { bddService } from '../bdd/BDDService.js';
import { getConfig } from '../../utils/configLoader.js';

// Lot implicite lorsque aucun lot gagnant n'est tiré
const LOSS_PAYOUT = { chance: 0, multiplier: 0, label: 'Perdu' };

export class CasinoService {
    constructor() {
        this.config = getConfig();
    }

    /**
     * Mise minimale acceptée
     * @returns {number}
     */
    getMinBet() {
        return this.config.casino.minBet;
    }

    /**
     * Mise maximale acceptée
     * @returns {number}
     */
    getMaxBet() {
        return this.config.casino.maxBet;
    }

    /**
     * Délai de réponse pour saisir la mise
     * @returns {number} - Durée en millisecondes
     */
    getResponseTimeMs() {
        return this.config.casino.responseTimeMs;
    }

    /**
     * Table des lots gagnants (du plus rare au plus fréquent)
     * @returns {Array<{chance: number, multiplier: number, label: string}>}
     */
    getPayouts() {
        return this.config.casino.payouts;
    }

    /**
     * Valide une mise saisie par le joueur
     * @param {number} amount - Montant saisi
     * @returns {{valid: boolean, reason: string}} - valid à true si la mise est jouable
     */
    validateBet(amount) {
        if (!Number.isInteger(amount)) {
            return { valid: false, reason: 'un nombre entier' };
        }
        if (amount < this.getMinBet()) {
            return { valid: false, reason: `au moins ${this.getMinBet()}$` };
        }
        if (amount > this.getMaxBet()) {
            return { valid: false, reason: `au plus ${this.getMaxBet()}$` };
        }
        return { valid: true, reason: '' };
    }

    /**
     * Tire un lot : parcourt les chances cumulées de la table, du plus rare
     * au plus fréquent. Si aucun lot n'est tombé, c'est la perte sèche.
     * @returns {{multiplier: number, label: string}} - Multiplicateur du gain (0 = mise perdue)
     */
    drawPayout() {
        const rng = Math.random();
        let cumulative = 0;
        for (const payout of this.getPayouts()) {
            cumulative += payout.chance;
            if (rng < cumulative) {
                return { multiplier: payout.multiplier, label: payout.label };
            }
        }
        return { multiplier: LOSS_PAYOUT.multiplier, label: LOSS_PAYOUT.label };
    }

    /**
     * Probabilité de perte sèche : ce qui reste quand aucun lot n'est tiré
     * @returns {number}
     */
    getLossChance() {
        return 1 - this.getPayouts().reduce((sum, payout) => sum + payout.chance, 0);
    }

    /**
     * Espérance de retour par unité misee : somme des chance x multiplicateur.
     * Doit rester strictement inférieure à 1 pour que le jeu soit à perte.
     * @returns {number}
     */
    getExpectedReturn() {
        return this.getPayouts().reduce((sum, payout) => sum + payout.chance * payout.multiplier, 0);
    }

    /**
     * Joue un pari : tire le lot puis règle l'opération en une seule mise à
     * jour atomique (débit de la mise et crédit du gain sont indivisibles)
     * @param {string} guildId - ID du serveur Discord (isolation des données)
     * @param {string} userId - ID Discord du dresseur
     * @param {number} bet - Mise validée au préalable par validateBet
     * @returns {Promise<{settled: boolean, payout: {multiplier: number, label: string}, gain: number, netChange: number, balance: number}>} -
     * settled à false si le solde était insuffisant au moment du règlement
     */
    async play(guildId, userId, bet) {
        const payout = this.drawPayout();
        const gain = Math.floor(payout.multiplier * bet);
        const netChange = gain - bet;
        const settleResult = await bddService.settleCasinoBet(guildId, userId, bet, netChange);
        const balance = await bddService.getMoneyForUser(guildId, userId);
        return { settled: settleResult === 0, payout, gain, netChange, balance };
    }
}

export const casinoService = new CasinoService();
