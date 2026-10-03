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

export class InventoryService {
    /**
     * Retourne le stock de balls d'un dresseur
     * @param {string} guildId - ID du serveur Discord (isolation des données)
     * @param {string} userId - ID Discord du dresseur
     * @returns {Promise<Object>} - { pokeball: number, superball: number, hyperball: number } (0 partout si inexistant)
     */
    async getInventory(guildId, userId) {
        const row = await bddService.getDresseur(guildId, userId);
        if (!row) {
            console.log("[INVENTAIRE] Erreur lecture BDD getInventory");
            return { pokeball: 0, superball: 0, hyperball: 0 };
        }
        return {
            pokeball: row.pokeball || 0,
            superball: row.superball || 0,
            hyperball: row.hyperball || 0
        };
    }

    /**
     * Retourne le stock de balls formaté pour l'affichage Discord
     * @param {string} guildId - ID du serveur Discord (isolation des données)
     * @param {string} userId - ID Discord du dresseur
     * @returns {Promise<string>} - Message du type "Ton inventaire : 2 pokeball, 0 superball, 0 hyperball"
     */
    async getInventoryDisplay(guildId, userId) {
        const inventory = await this.getInventory(guildId, userId);
        const inventoryList = Object.entries(inventory)
            .filter(([_, quantity]) => quantity >= 0)
            .map(([ballType, quantity]) => `${quantity} ${ballType}`)
            .join(', ');
        return `Ton inventaire : ${inventoryList}`;
    }
}

export const inventoryService = new InventoryService();
