/**
 * Générateur de phrases aléatoires
 * Responsabilité : piocher aléatoirement une phrase parmi un pool de gabarits
 * pour varier les messages du bot et éviter la répétition. Supporte des
 * substitutions : chaque séquence {clef} du gabarit est remplacée au moment
 * du tirage par la valeur correspondante (ex: {nomPoke}, {numPkm}).
 *
 * Exemple d'utilisation :
 *   import { PhrasesAleatoires } from './utils/phrasesAleatoires.js';
 *   const pool = new PhrasesAleatoires([
 *       'Un {nomPoke} apparaît !',
 *       'Tiens, un {nomPoke} traîne par ici...'
 *   ]);
 *   const message = pool.piocher({ nomPoke: 'Pikachu' });
 */

import { RandomUtils } from './randomUtils.js';

export class PhrasesAleatoires {
    #phrases = [];
    #phrasesRares = [];
    #dernierIndex = -1;

    /**
     * @param {Array<string>} [phrases] - Gabarits initiaux ; les séquences
     *        {clef} seront remplacées par les valeurs passées à piocher()
     * @param {Array<string>} [phrasesRares] - Gabarits initiaux ; les séquences
     *        {clef} seront remplacées par les valeurs passées à piocher()
     * @throws {Error} - Si un gabarit n'est pas une chaîne non vide
     */
    constructor(phrases = [], phrasesRares = []) {
        for (const phrase of phrases) {
            this.ajouter(phrase, false);
        }
        for (const phrase of phrasesRares) {
            this.ajouter(phrase, true);
        }
    }

    /**
     * Ajoute un gabarit au pool
     * @param {string} phrase - Gabarit à ajouter
     * @returns {void}
     */
    ajouter(phrase, isRare) {
        if (typeof phrase !== 'string' || phrase.trim() === '') {
            throw new Error(`Gabarit invalide : ${JSON.stringify(phrase)}`);
        }
        if(!isRare){
            this.#phrases.push(phrase);
            this.#dernierIndex = -1; // L'anti-répétition repart de zéro
        }
        else{
            //Cas ajout phrase rare
            this.#phrasesRares.push(phrase)
        }
        
    }

    /**
     * Nombre de gabarits disponibles
     * @returns {number}
     */
    get taille() {
        return this.#phrases.length;
    }

    /**
     * Pioche un gabarit au hasard et substitue les paramètres
     * Évite de rendre deux fois de suite la même phrase (si le pool en
     * contient au moins deux) pour limiter l'effet de répétition
     * @param {Object} [params] - Valeurs de substitution : chaque {clef} du
     *        gabarit est remplacée par params.clef
     * @returns {string} - Phrase prête à envoyer, chaîne vide si le pool est vide
     */
    piocher(params = {}) {
        //On tire un nombre au sort pour décider si on pioche une phrase commune ou rare
        let tirage = RandomUtils.nombreAleatoire(1, 100);

        if(tirage < 95 || this.#phrasesRares.length === 0){
            //Cas tirage phrase commune
            if (this.#phrases.length === 0) {
                return '';
            }

            let index = Math.floor(Math.random() * this.#phrases.length);
            if (this.#phrases.length > 1 && index === this.#dernierIndex) {
                // Retombe sur la phrase qui vient d'être tirée : décale d'un cran
                index = (index + 1) % this.#phrases.length;
            }
            this.#dernierIndex = index;

            return this.#substituer(this.#phrases[index], params);
        }
        else{
            //Cas tirage phrase rare
            let index = Math.floor(Math.random() * this.#phrasesRares.length);
            return this.#substituer(this.#phrasesRares[index], params);

        }
    }

    /**
     * Remplace chaque {clef} du gabarit par la valeur fournie
     * @param {string} gabarit - Phrase contenant des séquences {clef}
     * @param {Object} params - Clés/valeurs de substitution
     * @returns {string}
     */
    #substituer(gabarit, params) {
        let resultat = gabarit;
        for (const [clef, valeur] of Object.entries(params)) {
            resultat = resultat.replaceAll(`{${clef}}`, String(valeur));
        }
        return resultat;
    }
}
