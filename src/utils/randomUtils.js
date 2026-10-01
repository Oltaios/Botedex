/**
 * Utilitaires d'aléatoire
 * Responsabilité : centraliser les tirages aléatoires du bot (nombres entiers
 * dans un intervalle, etc.) pour éviter la duplication de formules
 * Math.random() éparpillées dans le code.
 *
 * Exemple d'utilisation :
 *   import { RandomUtils } from './utils/randomUtils.js';
 *   const numPkm = RandomUtils.nombreAleatoire(1, 151);
 */

export class RandomUtils {
    /**
     * Tire un nombre entier aléatoire dans l'intervalle [min, max], bornes incluses
     * @param {number} min - Borne inférieure (incluse)
     * @param {number} max - Borne supérieure (incluse)
     * @returns {number} - Entier compris entre min et max
     * @throws {Error} - Si min ou max n'est pas un nombre entier fini,
     *        ou si min est strictement supérieur à max
     */
    static nombreAleatoire(min, max) {
        if (!Number.isInteger(min) || !Number.isInteger(max)) {
            throw new Error(`Bornes invalides : min=${min}, max=${max} (entiers attendus)`);
        }
        if (min > max) {
            throw new Error(`Intervalle invalide : min (${min}) > max (${max})`);
        }
        return Math.floor(Math.random() * (max - min + 1)) + min;
    }
}
