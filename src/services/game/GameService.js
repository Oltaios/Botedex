/**
 * Service de gestion des mini-jeux
 * Responsabilité : administre les jetons de jeu quotidiens (un !game par
 * dresseur et par jour) et expose les récompenses configurées.
 *
 * Exemple d'utilisation :
 *   import { gameService } from './services/game/GameService.js';
 *   const reward = gameService.getReward('guessMyType');
 */

import { bddService } from '../bdd/BDDService.js';
import { getConfig } from '../../utils/configLoader.js';
import schedule from 'node-schedule';

export class GameService {
    constructor() {
        this.config = getConfig();
    }

    /**
     * Réinitialise les jetons de jeu pour tous les dresseurs
     * @returns {Promise<void>}
     */
    async resetAllGameTokens() {
        await bddService.resetGameAvailable();
    }

    /**
     * Planifie la réinitialisation quotidienne des jetons de jeu (tous les jours à minuit)
     * À appeler une seule fois au démarrage du bot
     */
    startDailyResetSchedule() {
        this.resetJob = schedule.scheduleJob('0 0 * * *', () => {
            this.resetAllGameTokens().catch(error => {
                console.error('Erreur lors du reset des jetons de jeu :', error);
            });
        });
        console.log('Reset quotidien des jetons de jeu planifié à minuit');
    }

    /**
     * Retourne la récompense pour un jeu spécifique
     * @param {string} gameName - Nom du jeu (ex: 'guessMyType')
     * @returns {number}
     */
    getReward(gameName) {
        const rewards = this.config.game;
        switch (gameName) {
            case 'guessMyType':
                return rewards.guessMyTypeRewardSingle; // ou Double selon le cas
            case 'guessMyName':
                return rewards.guessMyNameReward;
            default:
                return 0;
        }
    }
}

export const gameService = new GameService();
