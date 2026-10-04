/**
 * Commande !pokedex
 * Affiche le nombre de Pokémon capturés par un utilisateur
 * et le lien de sa checklist LivingDex (progression autoportée dans l'URL)
 * 
 * Exemple d'utilisation :
 *   import { execute } from './commands/pokedex.js';
 *   await execute(message);
 */

import { bddService } from '../services/bdd/BDDService.js';
import { construireLienDex } from '../utils/livingdex.js';

/**
 * Exécute la commande !pokedex
 * Répond en reply au message de commande
 * @param {Object} message - Message Discord
 */
export async function execute(message) {
    const dresseurId = message.author.id;
    const result = await bddService.getPokedexStateForUser(message.guildId, dresseurId);
    const dresseur = await bddService.getDresseur(message.guildId, dresseurId);
    const lienDex = construireLienDex(dresseur);
    await message.reply(
        `**Bip bip bip** Nombre de pokémons capturés : ${result} **Bip bip bip**
` +
        `Ta checklist : ${lienDex}`
    );
}

// Metadata pour l'aide automatique
export const metadata = {
    name: 'pokedex',
    description: 'Affiche le nombre de Pokémon capturés et ta checklist LivingDex',
    usage: '!pokedex',
    category: 'Pokémon'
};
