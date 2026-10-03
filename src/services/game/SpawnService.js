/**
 * Service de gestion des spawns de Pokémon
 * Responsabilité : faire apparaître des Pokémon aléatoires dans le channel
 * principal du bot, chaque spawn étant planifié après un délai aléatoire
 * re-tiré dans la plage configurée (spawn.minIntervalMinutes /
 * maxIntervalMinutes de gameConfig.json).
 * Le numéro du Pokémon actif est exposé via setNumPkmAvailable() dans
 * core/client.js pour que CaptureService sache qui est capturable.
 *
 * Exemple d'utilisation :
 *   import { spawnService } from './services/game/SpawnService.js';
 *   spawnService.startSpawn();
 */

import { getConfig } from '../../utils/configLoader.js';
import { channelService } from '../channel/ChannelService.js';
import { sendGif } from '../../utils/gif.js';
import { parsingPkm } from '../../utils/parsing.js';
import { clearTentativesCapture, setLockPkmAvailable, setNumPkmAvailable } from '../../core/client.js';
import { PhrasesAleatoires } from '../../utils/phrasesAleatoires.js';

export class SpawnService {
    constructor() {
        this.config = getConfig();
        this.spawnTimer = null;
        // Pools de phrases pour varier les annonces de spawn
        this.annoncesSpawn = new PhrasesAleatoires([
            "Un pokémon apparaît ! Il s'agit de {nomPoke} [{numPkm}] !",
            "Un {nomPoke} [{numPkm}] sauvage surgit des hautes herbes !",
            "Alerte : un {nomPoke} [{numPkm}] rôde dans le coin...",
            "Un {nomPoke} [{numPkm}] débarque sans prévenir, montrez-lui de quel Fanta vous vous chauffez !",
            "Tremblez, mortels : {nomPoke} [{numPkm}] vient d'apparaître !"
        ], [
            "Il n'est peut-être pas digne de CONSORT RADAHN, mais il a le mérite d'apparaître sous votre nez, voici {nomPoke} [{numPkm}] !",
            "Celui-là mériterait sûrement un @pin all, mais un seul dresseur pourra l'attraper de toute façon, {nomPoke} [{numPkm}] entre en jeu !",
            "Il ne s'est pas remis de sa dernière soirée, mais {nomPoke} [{numPkm}] est vaillant !",
            "Un {nomPoke} [{numPkm}] vient d'apparaître...Mais à quoi bon ? Sharoah ou Alombria sont sûrement co..."
        ]);
        this.appelsCapture = new PhrasesAleatoires([
            `Lancez **!capture** pour tenter de le seques... de le capturer !`,
            `Tapez **!capture** avant qu'il ne décampe !`,
            `Un petit **!capture**, ça vous tente ? Il ne se capturera pas tout seul.`,
            `**!capture** maintenant, ou pleure plus tard.`
        ]);
    }

    /**
     * Démarre le spawn automatique de Pokémon
     * Un premier spawn immédiat, puis un nouveau spawn après un délai
     * aléatoire re-tiré à chaque fois dans la plage configurée
     * @returns {void}
     */
    startSpawn() {
        if (this.spawnTimer) {
            this.stopSpawn();
        }

        console.log('[SPAWN] Démarrage des spawns');

        // Premier spawn immédiat
        this.spawnPokemon();

        // Puis spawns réguliers, avec un délai re-tiré aléatoirement à chaque fois
        this.scheduleNextSpawn();
    }

    /**
     * Planifie le prochain spawn après un délai aléatoire
     * Re-planifie à chaque exécution pour re-tirer le délai
     * @returns {void}
     */
    scheduleNextSpawn() {
        const minMinutes = this.config.spawn.minIntervalMinutes;
        const maxMinutes = this.config.spawn.maxIntervalMinutes;
        const randomDelay = this.getRandomDelay(minMinutes, maxMinutes);

        console.log(`[SPAWN] Prochain spawn dans ${randomDelay} minutes`);

        this.spawnTimer = setTimeout(() => {
            this.spawnPokemon();
            this.scheduleNextSpawn();
        }, randomDelay * 60 * 1000); // Convertit les minutes en millisecondes
    }

    /**
     * Arrête le spawn automatique
     */
    stopSpawn() {
        if (this.spawnTimer) {
            clearTimeout(this.spawnTimer);
            this.spawnTimer = null;
            console.log('[SPAWN] Arrêt des spawns');
        }
    }

    /**
     * Fait apparaître un Pokémon aléatoire dans le channel principal
     * Tire un numéro entre 1 et game.numberOfPokemon, l'expose comme spawn
     * actif et annonce le Pokémon (phrase piochée au hasard + GIF)
     * @returns {Promise<void>}
     */
    async spawnPokemon() {

        const randomNumPkm = Math.floor(Math.random() * this.config.game.numberOfPokemon) + 1;
        const arrayParsingPkm = parsingPkm(randomNumPkm);
        const nomPokeENG = arrayParsingPkm[0];
        const captureRate = arrayParsingPkm[1];
        const nomPokeFR = arrayParsingPkm[2];
        console.log("[SPAWN] NOM : " + nomPokeFR + " avec un taux de capture de " + captureRate);
        setNumPkmAvailable(randomNumPkm);
        setLockPkmAvailable(0);
        clearTentativesCapture(); // Nouveau Pokémon : repart de zéro sur les tentatives
        channelService.sendMessage(this.annoncesSpawn.piocher({ nomPoke: nomPokeFR, numPkm: randomNumPkm }))

        //utilisation de @pokemon pour cibler des stickers generes par le compte officiel de Pokemon sur Giphy
        await sendGif(nomPokeENG + " @pokemon");
        // TODO: Intégrer avec la logique de capture
        // Exemple: Demander si un utilisateur veut capturer le Pokémon
        channelService.sendMessage(this.appelsCapture.piocher());
    }

    /**
     * Génère un délai aléatoire entre min et max minutes
     * @param {number} min - Minutes minimum
     * @param {number} max - Minutes maximum
     * @returns {number} - Délai en minutes
     */
    getRandomDelay(min, max) {
        return Math.floor(Math.random() * (max - min + 1)) + min;
    }
}

export const spawnService = new SpawnService();
