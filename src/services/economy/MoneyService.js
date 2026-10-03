/**
 * Service de gestion de l'argent
 * Responsabilité : opérations sur le solde des dresseurs (actuellement
 * seulement le crédit). Délègue la persistance à BDDService.
 *
 * Exemple d'utilisation :
 *   import { moneyService } from './services/economy/MoneyService.js';
 *   await moneyService.gainMoney(guildId, idDiscord, 100);
 */

import { bddService } from '../bdd/BDDService.js';

export class MoneyService {
    /**
     * Ajoute de l'argent à un dresseur
     * @param {string} guildId - ID du serveur Discord (isolation des données)
     * @param {string} userId - ID Discord du dresseur
     * @param {number} amount - Montant à ajouter
     * @returns {Promise<void>} - Sans effet si le dresseur n'existe pas
     */
    async gainMoney(guildId, userId, amount) {
        await bddService.gainMoney(guildId, userId, amount);
    }
}

export const moneyService = new MoneyService();
