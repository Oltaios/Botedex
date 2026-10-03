/**
 * Commande !pokedex
 * Affiche le nombre de Pokémon capturés par un utilisateur
 * 
 * Exemple d'utilisation :
 *   import { execute } from './commands/pokedex.js';
 *   await execute(message);
 */

import { bddService } from '../services/bdd/BDDService.js';

/**
 * Exécute la commande !pokedex
 * Répond en reply au message de commande
 * @param {Object} message - Message Discord
 */
export async function execute(message) {
    const dresseurId = message.author.id;
    const result = await bddService.getPokedexStateForUser(message.guildId, dresseurId);
    await message.reply(`**Bip bip bip** Nombre de pokémons capturés : ${result} **Bip bip bip**`);
}

// Metadata pour l'aide automatique
export const metadata = {
    name: 'pokedex',
    description: 'Affiche le nombre de Pokémon capturés',
    usage: '!pokedex',
    category: 'Pokémon'
};
