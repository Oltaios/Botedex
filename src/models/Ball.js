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
        this.rate = ballConfig.rate;
        this.price = ballConfig.price;
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
     * Retourne le prix de la ball
     * @returns {number}
     */
    getPrice() {
        return this.price;
    }
}
