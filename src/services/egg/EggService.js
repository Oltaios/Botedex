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
import { moneyService } from '../economy/MoneyService.js';
import { getConfig } from '../../utils/configLoader.js';
import { RandomUtils } from '../../utils/randomUtils.js';
import { parsingPkm } from '../../utils/parsing.js';
import { aCaptureDex } from '../../utils/dexBits.js';
import { PhrasesAleatoires } from '../../utils/phrasesAleatoires.js';
import { channelService } from '../channel/ChannelService.js';
import { sendGif } from '../../utils/gif.js';

export class EggService {
    // Nombre de captures nécessaires pour faire éclore l'œuf
    #capturesRequises;

    constructor() {
        this.#capturesRequises = getConfig().egg?.capturesRequises ?? 10;
        // Messages d'éclosion d'œuf : chaque variante garde le mot-clé "éclos"
        // attendu par les tests d'intégration
        this.messagesEclosion = new PhrasesAleatoires([
            "🥚 **Crac !** Ton œuf a éclos : un {nomPoke} en sort et rejoint ton Pokédex !",
            "🥚 **Crac !** Pendant que tu capturais, ton œuf a éclos : bonjour {nomPoke} !",
            "🥚 **Crac !** Ton œuf a éclos, et c'est un {nomPoke} qui pointe le bout de son nez !"
        ]);
        // Messages envoyés à l'éclosion quand le Pokémon tiré est un doublon
        this.messagesEclosionDoublon = new PhrasesAleatoires([
            "🥚 **Crac !** Ton œuf a éclos : un {nomPoke} en sort... mais tu l'avais déjà ! La Team Rocket le revend **{reward}$**.",
            "🥚 **Crac !** Pendant que tu capturais, un {nomPoke} est sorti de l'œuf — doublon ! Revendu **{reward}$**.",
            "🥚 **Crac !** Un {nomPoke} pointe le bout de son nez hors de l'œuf... déjà capturé ! Il repart pour **{reward}$**."
        ], [
            "🥚 **Crac !** Doublon de {nomPoke} ! La Team Rocket envoie un conteneur frigorifique et te file **{reward}$** pour ta discrétion."
        ]);
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
     * l'œuf d'une capture et, si le seuil est atteint, fait éclore l'œuf.
     * Le Pokémon obtenu a 2 chances sur 3 d'être un Pokémon que le dresseur
     * n'a pas encore ; si le Pokémon tiré est déjà possédé, le dresseur
     * reçoit à la place la récompense de doublon (economy.duplicateCaptureReward)
     * @param {string} guildId - ID du serveur Discord (isolation des données)
     * @param {string} userId - ID Discord du dresseur
     * @param {Object|null} [message=null] - Message Discord de la commande en cours :
     *        si fourni, le message d'éclosion lui est envoyé en reply
     * @returns {Promise<Object|null>} - { numPkm, doublon, message } si l'éclosion
     *          a eu lieu (doublon = true si le Pokémon était déjà au Pokédex : la
     *          récompense de doublon est créditée et `message` contient le texte
     *          affiché), null sinon
     */
    async onCapture(guildId, userId, message = null) {
        const etat = await bddService.progressEgg(guildId, userId);
        if (!etat) {
            return null; // Pas d'œuf en incubation
        }
        if (etat.eggCaptures < this.#capturesRequises) {
            return null; // L'œuf progresse mais n'est pas prêt
        }
        const tirage = await this.tirerPkmEclosion(guildId, userId);
        const eclos = await bddService.hatchEgg(guildId, userId, tirage.numPkm, this.#capturesRequises);
        if (eclos !== 0) {
            return null;
        }
        // L'éclosion a lieu : le message est préparé ici, puis envoyé au
        // dresseur si le message Discord de la commande est fourni
        const pkm = parsingPkm(tirage.numPkm);
        const nomEclos = '**' + pkm[2] + ' [' + tirage.numPkm + ']**';
        if (tirage.doublon) {
            // Doublon : pas de nouveau Pokémon au Pokédex, mais la récompense de doublon
            const reward = getConfig().economy?.duplicateCaptureReward ?? 0;
            await moneyService.gainMoney(guildId, userId, reward);
            tirage.message = this.messagesEclosionDoublon.piocher({ nomPoke: nomEclos, reward });
        } else {
            tirage.message = this.messagesEclosion.piocher({ nomPoke: nomEclos });
        }
        if (message) {
            await channelService.replySafe(message, tirage.message);
        }
        // GIF du Pokémon éclos : recherche Giphy avec le NOM ANGLAIS + @pokemon
        // (comme les spawns), en reply à la commande si fournie
        await sendGif(pkm[0], message ?? null);
        return tirage;
    }

    /**
     * Tire le Pokémon de l'éclosion : 2 chances sur 3 de tomber sur un
     * Pokémon non obtenu par le dresseur (s'il lui en reste), sinon tirage
     * uniforme parmi tous les Pokémon (1..game.numberOfPokemon)
     * @param {string} guildId - ID du serveur Discord
     * @param {string} userId - ID Discord du dresseur
     * @returns {Promise<Object>} - { numPkm, doublon }
     */
    async tirerPkmEclosion(guildId, userId) {
        const nbPkm = getConfig().game.numberOfPokemon;
        const bits = await bddService.getDexBitsForUser(guildId, userId);
        const nonObtenus = [];
        for (let i = 1; i <= nbPkm; i++) {
            if (!aCaptureDex(bits, i)) nonObtenus.push(i);
        }
        let numPkm;
        if (nonObtenus.length > 0 && Math.random() < 2 / 3) {
            numPkm = nonObtenus[Math.floor(Math.random() * nonObtenus.length)];
        } else {
            numPkm = RandomUtils.nombreAleatoire(1, nbPkm);
        }
        return { numPkm, doublon: aCaptureDex(bits, numPkm) };
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
