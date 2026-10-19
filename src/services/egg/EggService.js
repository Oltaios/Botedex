/**
 * Service de l'œuf (Singleton)
 * Responsabilité : logique métier de l'œuf de Pokémon — obtention d'un œuf,
 * état d'éclosion flou (le décompte exact de captures reste caché au
 * dresseur) et éclosion après le nombre de captures requis (config egg),
 * qui offre un Pokémon aléatoire au dresseur.
 *
 * Le seuil est piloté par la config (egg.capturesRequises) ; la progression
 * et l'éclosion sont déléguées aux opérations atomiques de BDDService
 * (progressEgg/hatchEgg), ce service tire le Pokémon offert et traduit
 * l'état en message.
 *
 * Utilisation :
 *   import { eggService } from './services/egg/EggService.js';
 *   await eggService.donnerOeuf(guildId, userId);
 *   await eggService.getEtatOeuf(guildId, userId);
 *   const numEclos = await eggService.onCapture(guildId, userId);
 */

import { bddService } from '../bdd/BDDService.js';
import { getConfig } from '../../utils/configLoader.js';
import { RandomUtils } from '../../utils/randomUtils.js';

export class EggService {
    // Nombre de captures nécessaires pour faire éclore l'œuf
    #capturesRequises;

    constructor() {
        this.#capturesRequises = getConfig().egg?.capturesRequises ?? 10;
    }

    /**
     * Getter du seuil d'éclosion (pour l'aide et les tests)
     * @returns {number} - Nombre de captures requises pour l'éclosion
     */
    get capturesRequises() {
        return this.#capturesRequises;
    }

    /**
     * Confie un œuf au dresseur (un seul œuf en incubation à la fois)
     * @param {string} guildId - ID du serveur Discord (isolation des données)
     * @param {string} userId - ID Discord du dresseur
     * @returns {Promise<boolean>} - true si l'œuf est confié, false si le
     *          dresseur a déjà un œuf en incubation
     */
    async donnerOeuf(guildId, userId) {
        return await bddService.giveEgg(guildId, userId) === 0;
    }

    /**
     * Retourne le message d'état de l'œuf, volontairement flou : le
     * dresseur ne connaît jamais le décompte exact, seulement un palier
     * (loin / ça bouge / bientôt)
     * @param {string} guildId - ID du serveur Discord (isolation des données)
     * @param {string} userId - ID Discord du dresseur
     * @returns {Promise<string|null>} - Message d'état, ou null si le
     *          dresseur n'a pas d'œuf en incubation
     */
    async getEtatOeuf(guildId, userId) {
        const etat = await bddService.getEggState(guildId, userId);
        if (!etat || etat.eggActive !== 1) {
            return null;
        }
        return this.#messageEtat(etat.eggCaptures);
    }

    /**
     * À appeler après chaque capture réussie du dresseur : fait progresser
     * l'œuf d'une capture et, si le seuil est atteint, fait éclore l'œuf —
     * un Pokémon aléatoire (1 à game.numberOfPokemon) est alors ajouté au
     * Pokédex du dresseur
     * @param {string} guildId - ID du serveur Discord (isolation des données)
     * @param {string} userId - ID Discord du dresseur
     * @returns {Promise<number|null>} - Numéro du Pokémon issu de l'œuf si
     *          l'éclosion a eu lieu, null sinon (pas d'œuf ou seuil non atteint)
     */
    async onCapture(guildId, userId) {
        const etat = await bddService.progressEgg(guildId, userId);
        if (!etat) {
            return null; // Pas d'œuf en incubation
        }
        if (etat.eggCaptures < this.#capturesRequises) {
            return null; // L'œuf progresse mais n'est pas prêt
        }
        const numPkm = RandomUtils.nombreAleatoire(1, getConfig().game.numberOfPokemon);
        const eclos = await bddService.hatchEgg(guildId, userId, numPkm, this.#capturesRequises);
        return eclos === 0 ? numPkm : null;
    }

    /**
     * Traduit un nombre de captures en message d'état flou, sans jamais
     * révéler le décompte : trois paliers calculés sur le seuil configuré
     * @param {number} captures - Captures effectuées depuis l'obtention
     * @returns {string} - Message d'état
     */
    #messageEtat(captures) {
        if (captures >= Math.ceil((this.#capturesRequises * 2) / 3)) {
            return "L'œuf éclôt bientôt !";
        }
        if (captures >= Math.ceil(this.#capturesRequises / 3)) {
            return "L'œuf commence à bouger !";
        }
        return "On est encore loin de l'éclosion !";
    }
}

// Exporte une instance unique (Singleton)
export const eggService = new EggService();
