/**
 * Modèle Ball (Pokéball, Superball, Hyperball)
 * Représente un type de ball avec ses caractéristiques (prix, multiplicateur
 * de capture) chargées depuis config/gameConfig.json.
 *
 * Exemple d'utilisation :
 *   import { Ball } from './models/Ball.js';
 *   const pokeball = new Ball('pokeball');
 */

import { getConfig } from '../utils/configLoader.js';

export class Ball {
    /**
     * @param {string} name - Type de ball ('pokeball', 'superball', 'hyperball')
     * @throws {Error} - Si le type de ball est inconnu de la config
     */
    constructor(name) {
        console.log("Ball constructor : name = " + name);
        this.type = name;
        
        // Charge la config pour ce type de ball
        const config = getConfig();
        const ballConfig = config.balls[this.type];
        
        if (!ballConfig) {
            throw new Error(`Type de Pokéball inconnu: ${this.type}`);
        }
        
        // Applique les valeurs depuis la config
        // Nom d'affichage (première lettre en majuscule) : "nom" de la config,
        // repli sur le type si absent
        this.nom = ballConfig.nom ?? name;
        this.rate = ballConfig.rate;
        this.price = ballConfig.price;
        // Balls à efficacité typée : rateEfficace s'applique si le Pokémon
        // a au moins un type de typesEfficaces, sinon on retombe sur rate
        this.rateEfficace = ballConfig.rateEfficace ?? null;
        this.typesEfficaces = ballConfig.typesEfficaces ?? null;
    }
    
    /**
     * Retourne le type de la ball
     * @returns {string}
     */
    getType() {
        return this.type;
    }
    
    /**
     * Retourne le rate de capture de la ball
     * @returns {number}
     */
    getRate() {
        return this.rate;
    }

    /**
     * Retourne le rate effectif de la ball contre un Pokémon de types donnés :
     * rateEfficace si au moins un type du Pokémon est dans typesEfficaces
     * (comparaison insensible à la casse), sinon le rate de base.
     * Sans typesEfficaces (balls classiques), le rate de base s'applique toujours.
     * @param {string} type1 - Type 1 du Pokémon (français, ex: 'plante')
     * @param {string} type2 - Type 2 du Pokémon (français, peut être vide)
     * @returns {number}
     */
    getRateContre(type1, type2) {
        if (!this.typesEfficaces) return this.rate;
        const typesPkm = [type1, type2].filter(Boolean).map((s) => s.toLowerCase());
        return this.typesEfficaces.some((t) => typesPkm.includes(t.toLowerCase()))
            ? (this.rateEfficace ?? this.rate)
            : this.rate;
    }
    
    /**
     * Retourne le prix de la ball
     * @returns {number}
     */
    getPrice() {
        return this.price;
    }

    /**
     * Retourne le nom d'affichage de la ball (ex: "Pokeball", "MaitreBall")
     * @returns {string}
     */
    getNom() {
        return this.nom;
    }
}
