/**
 * Modèle Pokémon
 * Représente un Pokémon avec son numéro, son nom et ses types
 *
 * Exemple d'utilisation :
 *   import { Pokemon } from './models/Pokemon.js';
 *   const pkm = new Pokemon(25, 'Pikachu', 'electric', null);
 */

export class Pokemon {
    /**
     * @param {number} numPkm - Numéro du Pokémon (1-154)
     * @param {string} nom - Nom du Pokémon
     * @param {string} type1 - Premier type (ex: 'electric')
     * @param {string|null} [type2] - Deuxième type, ou null si monotype
     */
    constructor(numPkm, nom, type1, type2 = null) {
        this.numPkm = numPkm;
        this.nom = nom;
        this._type1 = type1;
        this._type2 = type2;
    }

    /**
     * Retourne le premier type du Pokémon
     * @returns {string}
     */
    getType1() {
        return this._type1;
    }
    
    /**
     * Retourne le deuxième type du Pokémon (ou null)
     * @returns {string|null}
     */
    getType2() {
        return this._type2;
    }

    /**
     * Retourne le nom du Pokémon
     * @returns {string}
     */
    getNom() {
        return this.nom;
    }
}
