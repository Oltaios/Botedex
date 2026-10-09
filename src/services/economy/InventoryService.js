/**
 * Service de gestion de l'inventaire (Balls)
 * Responsabilité : lecture du stock de balls d'un dresseur et formatage
 * pour l'affichage. L'écriture (décompte) reste dans BDDService.
 *
 * Exemple d'utilisation :
 *   import { inventoryService } from './services/economy/InventoryService.js';
 *   const stock = await inventoryService.getInventory(guildId, idDiscord);
 */

import { bddService } from '../bdd/BDDService.js';
import { getConfig } from '../../utils/configLoader.js';

export class InventoryService {
    /**
     * Retourne le stock de balls d'un dresseur
     * @param {string} guildId - ID du serveur Discord (isolation des données)
     * @param {string} userId - ID Discord du dresseur
     * @returns {Promise<Object>} - { <typeDeBall>: number } pour chaque type de la config
     *        (0 partout si le dresseur n'existe pas ou ne possède pas le type)
     */
    async getInventory(guildId, userId) {
        const row = await bddService.getDresseur(guildId, userId);
        const ballTypes = Object.keys(getConfig().balls);
        if (!row) {
            console.log("[INVENTAIRE] Erreur lecture BDD getInventory");
            return Object.fromEntries(ballTypes.map(ballType => [ballType, 0]));
        }
        return Object.fromEntries(ballTypes.map(ballType => [ballType, row[ballType] || 0]));
    }

    /**
     * Retourne le stock de balls formaté pour l'affichage Discord
     * @param {string} guildId - ID du serveur Discord (isolation des données)
     * @param {string} userId - ID Discord du dresseur
     * @returns {Promise<string>} - Message du type "Ton inventaire : 2 Pokeball, 0 Superball, 0 Hyperball"
     */
    async getInventoryDisplay(guildId, userId) {
        const inventory = await this.getInventory(guildId, userId);
        const inventoryList = Object.entries(inventory)
            .filter(([_, quantity]) => quantity >= 0)
            .map(([ballType, quantity]) => `${quantity} ${getConfig().balls[ballType]?.nom ?? ballType}`)
            .join(', ');
        return `Ton inventaire : ${inventoryList}`;
    }
}

export const inventoryService = new InventoryService();
