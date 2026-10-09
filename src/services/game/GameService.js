/**
 * Service de gestion des mini-jeux
 * Responsabilité : administre les jetons de jeu (une partie par heure
 * courante et par jeu et par dresseur, sans reset planifié : la date du
 * dernier jeton consommé est stockée en base et comparée à l'heure
 * courante), expose les récompenses configurées et orchestre les mini-jeux
 * eux-mêmes (choix du jeu, déroulé, récompense).
 * Deux usages : "!game <type>" lance directement le mini-jeu demandé,
 * "!game" seul laisse le dresseur choisir en répondant "!<type>".
 *
 * Exemple d'utilisation :
 *   import { gameService } from './services/game/GameService.js';
 *   await gameService.startGame(message, 'type');
 */

import { bddService } from '../bdd/BDDService.js';
import { moneyService } from '../economy/MoneyService.js';
import { channelService } from '../channel/ChannelService.js';
import { getConfig } from '../../utils/configLoader.js';
import { sendGif } from '../../utils/gif.js';
import { Pokemon } from '../../models/Pokemon.js';
import { parsingPkmNomType1Type2, parsingPkmNomPoids } from '../../utils/parsing.js';
import { pendingResponses } from '../../core/client.js';

export class GameService {
    constructor() {
        this.config = getConfig();
        // Jeux disponibles : clé = type saisi par le dresseur (ex: "!type"),
        // description affichée lors du choix, launch = lanceur du jeu
        // (reçoit le type de jeu, clé du jeton horaire en base)
        this.games = {
            type: {
                description: 'Devine le ou les types d\'un Pokémon',
                launch: (message, gameType) => this.guessMyType(message, gameType)
            },
            weight: {
                description: 'Devine le poids d\'un Pokémon',
                launch: (message, gameType) => this.guessMyWeight(message, gameType)
            }
        };
    }

    /**
     * Clé identifiant l'heure d'une date (année, mois, jour et heure, heure
     * locale du serveur) : deux dates de la même heure donnent la même clé,
     * quelle que soit la minute
     * @param {Date} date - Date à identifier
     * @returns {number}
     */
    cleHeure(date) {
        return date.getFullYear() * 1000000
            + (date.getMonth() + 1) * 10000
            + date.getDate() * 100
            + date.getHours();
    }

    /**
     * Indique si un jeu est disponible pour un dresseur : il ne l'a pas
     * déjà joué pendant l'heure courante (la date de consommation du jeton
     * est stockée dans gameTokens en base, à la première réponse)
     * @param {string} guildId - ID du serveur Discord
     * @param {string} dresseurId - ID Discord du dresseur
     * @param {string} gameType - Type de jeu (ex: 'type', 'weight')
     * @returns {Promise<boolean>}
     */
    async isGameAvailable(guildId, dresseurId, gameType) {
        const lastPlayedAt = await bddService.getGameLastPlayedAt(guildId, dresseurId, gameType);
        return lastPlayedAt === null || this.cleHeure(lastPlayedAt) !== this.cleHeure(new Date());
    }

    /**
     * Point d'entrée des mini-jeux, appelé par la commande !game
     * - type fourni ("!game type") : lance directement le mini-jeu
     * - type absent ("!game") : demande le choix du jeu en différé
     * @param {Object} message - Message Discord ayant déclenché la commande
     * @param {string|null} gameType - Type de jeu saisi, ou null si absent
     * @returns {Promise<void>}
     */
    async startGame(message, gameType = null) {
        if (gameType === null) {
            await this.gererChoixDuJeu(message);
            return;
        }

        const game = this.games[gameType];
        if (!game) {
            await channelService.replySafe(message, `🎮 Je ne connais pas ce mini-jeu. Jeux disponibles :\n${this.listerJeux()}`);
            return;
        }

        await this.lancerJeu(message, gameType);
    }

    /**
     * Lance un jeu après vérification de son jeton horaire
     * @param {Object} message - Message Discord ayant déclenché la commande
     * @param {string} gameType - Type de jeu à lancer
     * @returns {Promise<void>}
     */
    async lancerJeu(message, gameType) {
        const guildId = message.guildId;
        const dresseurId = message.author.id;

        if (!(await this.isGameAvailable(guildId, dresseurId, gameType))) {
            await channelService.replySafe(message, "❌ Jeu non disponible, il faut attendre le début de la prochaine heure ! Espèce de drogué.");
            return;
        }

        await this.games[gameType].launch(message, gameType);
    }

    /**
     * Liste les jeux pour l'affichage (une ligne par jeu)
     * @param {Object} [jeux=this.games] - Jeux à lister (tous par défaut)
     * @returns {string}
     */
    listerJeux(jeux = this.games) {
        return Object.entries(jeux)
            .map(([type, game]) => `**!${type}** - ${game.description}`)
            .join('\n');
    }

    /**
     * Gère le choix du jeu en différé ("!game" puis "!<type>")
     * Demande le type de jeu au dresseur et attend sa réponse (choix du
     * jeu en différé, config game.chooseGameTimeMs). Une réponse inconnue
     * est refusée sans consommer le jeton ; le jeu choisi est lancé dès
     * qu'il est valide.
     * @param {Object} message - Message Discord de la commande !game
     * @returns {Promise<void>}
     */
    async gererChoixDuJeu(message) {
        const guildId = message.guildId;
        const dresseurId = message.author.id;

        // Seuls les jeux pas encore joués pendant l'heure courante sont proposés
        const jeuxDisponibles = {};
        for (const [type, game] of Object.entries(this.games)) {
            if (await this.isGameAvailable(guildId, dresseurId, type)) {
                jeuxDisponibles[type] = game;
            }
        }

        if (Object.keys(jeuxDisponibles).length === 0) {
            await channelService.replySafe(message, "❌ Jeu non disponible, il faut attendre le début de la prochaine heure ! Espèce de drogué.");
            return;
        }

        const premierJeu = Object.keys(jeuxDisponibles)[0];
        await channelService.replySafe(message,
            `🎮 Quel mini-jeu veux-tu lancer ?\n${this.listerJeux(jeuxDisponibles)}\nExemple de réponse : **!${premierJeu}**`);

        const responseKey = `game-choose:${message.channel.id}:${dresseurId}`;
        // Marque le joueur comme "en attente de réponse" pour ignorer ses messages dans messageCreate
        pendingResponses.add(responseKey);

        const filter = m => m.author.id === dresseurId && m.content.startsWith("!");
        const collector = message.channel.createMessageCollector({ filter, time: this.config.game.chooseGameTimeMs });

        collector.on('collect', async collected => {
            const gameType = collected.content.slice(1).toLowerCase();
            const game = this.games[gameType];
            if (!game) {
                await channelService.replySafe(collected, `🎮 Je ne connais pas ce mini-jeu. Jeux disponibles :\n${this.listerJeux(jeuxDisponibles)}`);
                // Relance le compte à rebours pour laisser le dresseur retenter
                collector.resetTimer();
                return;
            }
            if (!(await this.isGameAvailable(guildId, dresseurId, gameType))) {
                await channelService.replySafe(collected, "❌ Tu as déjà joué à ce mini-jeu pendant cette heure ! Choisis-en un autre ou patiente jusqu'à la prochaine heure.");
                collector.resetTimer();
                return;
            }
            collector.stop();
            console.log(`User ${dresseurId} (${message.author.username}) a choisi le mini-jeu ${gameType}`);
            await game.launch(message, gameType);
        });

        collector.on('end', (collected, reason) => {
            if (reason === 'time') {
                channelService.replySafe(message, "⏰ Temps écoulé, aucun mini-jeu lancé !");
            }
            pendingResponses.delete(responseKey); // Libère la clé
        });
    }

    /**
     * Mini-jeu "guessMyType" : envoie un Pokémon aléatoire (GIF) et le dresseur
     * doit deviner son ou ses types en un nombre limité d'essais et de temps
     * (config game de gameConfig.json). Réponse attendue : "!<type>" ou
     * "!<type1>/<type2>". Le jeton horaire (une partie par heure courante et
     * par jeu) est consommé dès la première réponse.
     * @param {Object} message - Message Discord ayant déclenché le jeu
     * @param {string} gameType - Type de jeu (clé du jeton horaire en base)
     * @returns {Promise<void>}
     */
    async guessMyType(message, gameType) {
        const dresseurId = message.author.id;
        const guildId = message.guildId;
        const gameConfig = this.config.game;

        const numPkm = Math.floor(Math.random() * gameConfig.numberOfPokemon) + 1;
        const { nomPokeENG, type_1, type_2, nomPokeFR } = parsingPkmNomType1Type2(numPkm);
        const pkm2Guess = new Pokemon(numPkm, nomPokeENG, type_1, type_2 || null);
        await sendGif(pkm2Guess.nom + " pokemon", message);
        const reward = this.getReward('guessMyType');
        const type1 = pkm2Guess.getType1();
        const type2 = pkm2Guess.getType2();

        console.log(`User ${dresseurId} (${message.author.username}) launched guessMyType and picked ${nomPokeFR} ${type1}${type2 !== null ? `/${type2}` : ''} to guess`);

        await channelService.replySafe(message,
            `🎮 Un dresseur étrange surgit et envoie un ${nomPokeFR}, il te met au défi de trouver son ou ses types ! ` +
            `\nTu as ${gameConfig.guessMyTypeMaxAttempts} essais.` +
            `\n(Ensemble des types : normal / feu /eau / electrik / plante / glace / combat / poison / sol / vol / psy / insecte / roche / spectre / dragon / tenebres / acier / fee )` +
            `\nExemple d'une réponse : **!normal** ou **!normal/roche** (l'ordre en cas de double type n'est pas important)`
        );

        const responseKey = `${message.channel.id}:${message.author.id}`;
        // Marque le joueur comme "en attente de réponse" pour ignorer ses messages dans messageCreate
        pendingResponses.add(responseKey);

        const filter = m => m.author.id === dresseurId && m.content.startsWith("!");
        const collector = message.channel.createMessageCollector({ filter, max: gameConfig.guessMyTypeMaxAttempts, time: gameConfig.guessMyTypeTimeMs });

        collector.on('collect', async collected => {

            // Réponses acceptées : le type seul si monotype, les deux ordres si double type
            const answer = collected.content.slice(1).toLowerCase();
            const expectedAnswers = type2 === null
                ? [type1]
                : [`${type1}/${type2}`, `${type2}/${type1}`];

            // Le jeton est consommé dès la première réponse, gagnant ou perdant
            if (collector.collected.size === 1) {
                await bddService.recordGamePlayed(guildId, dresseurId, gameType, new Date());
            }

            if (expectedAnswers.includes(answer)) {
                await channelService.replySafe(collected, `🎉 You found it ! Well played ! U gained ${reward} pokédollars !`);
                await moneyService.gainMoney(guildId, dresseurId, reward);
                collector.stop();
                return;
            }

            // Mauvaise réponse : on laisse les essais restants sans révéler la solution
            const attemptsLeft = gameConfig.guessMyTypeMaxAttempts - collector.collected.size;
            if (attemptsLeft > 0) {
                await channelService.replySafe(collected, `❌ Nope ! Il te reste ${attemptsLeft} essai${attemptsLeft > 1 ? 's' : ''}.`);
                // Relance le compte à rebours pour l'essai suivant
                collector.resetTimer();
            } else {
                await channelService.replySafe(collected, "😵 Damn u suck :c\nThe answer was " + "!" + expectedAnswers[0]);
                collector.stop();
            }
        });

        collector.on('end', (collected, reason) => {
            if (reason === 'time') {
                channelService.replySafe(message, `⏰ Temps écoulé, tu serais pas un peu guez ? La réponse était ${type1}${type2 !== null ? `/${type2}` : ''}`);
            }
            pendingResponses.delete(responseKey); // Libère la clé
        });
    }

    /**
     * Mini-jeu "guessMyWeight" : envoie un Pokémon aléatoire (GIF) et le dresseur
     * doit deviner son poids en kilogrammes en un nombre limité d'essais et de
     * temps (config game de gameConfig.json). Réponse attendue : "!<poids>",
     * point ou virgule comme séparateur décimal (ex: "!6.9" ou "!6,9"). Une
     * réponse dans la marge de tolérance autour du poids réel (±
     * guessMyWeightTolerance, 10 % par défaut) est acceptée ; une mauvaise
     * réponse donne un indice ("plus lourd" / "plus léger"). Le jeton
     * horaire (une partie par heure courante et par jeu) est consommé dès
     * la première réponse.
     * @param {Object} message - Message Discord ayant déclenché le jeu
     * @param {string} gameType - Type de jeu (clé du jeton horaire en base)
     * @returns {Promise<void>}
     */
    async guessMyWeight(message, gameType) {
        const dresseurId = message.author.id;
        const guildId = message.guildId;
        const gameConfig = this.config.game;

        const numPkm = Math.floor(Math.random() * gameConfig.numberOfPokemon) + 1;
        const { nomPoke: nomPokeENG, poids, nomPokeFR } = parsingPkmNomPoids(numPkm);
        await sendGif(nomPokeENG + " @pokemon", message);
        const reward = this.getReward('guessMyWeight');
        const expectedWeight = parseFloat(poids);
        const marge = expectedWeight * gameConfig.guessMyWeightTolerance;
        const margePourcent = Math.round(gameConfig.guessMyWeightTolerance * 100);

        console.log(`User ${dresseurId} (${message.author.username}) launched guessMyWeight and picked ${nomPokeFR} ${poids} kg to guess (tolérance ±${marge} kg)`);

        await channelService.replySafe(message,
            `🎮 Un dresseur étrange surgit et envoie un ${nomPokeFR}, il te met au défi d'estimer son poids ! ` +
            `\nTu as ${gameConfig.guessMyWeightMaxAttempts} essais.` +
            `\nUne marge de ±${margePourcent} % autour du poids réel est acceptée.` +
            `\nExemple d'une réponse : **!6.9** ou **!6,9** (en kilogrammes, séparateur point ou virgule)`
        );

        const responseKey = `${message.channel.id}:${message.author.id}`;
        // Marque le joueur comme "en attente de réponse" pour ignorer ses messages dans messageCreate
        pendingResponses.add(responseKey);

        const filter = m => m.author.id === dresseurId && m.content.startsWith("!");
        const collector = message.channel.createMessageCollector({ filter, max: gameConfig.guessMyWeightMaxAttempts, time: gameConfig.guessMyWeightTimeMs });

        collector.on('collect', async collected => {

            // Réponse acceptée : dans la marge de tolérance, point ou virgule comme séparateur décimal
            const answer = parseFloat(collected.content.slice(1).trim().replace(',', '.'));

            // Le jeton est consommé dès la première réponse, gagnant ou perdant
            if (collector.collected.size === 1) {
                await bddService.recordGamePlayed(guildId, dresseurId, gameType, new Date());
            }

            if (!isNaN(answer) && Math.abs(answer - expectedWeight) <= marge) {
                await channelService.replySafe(collected, `🎉 You found it ! Well played ! U gained ${reward} pokédollars !\n(Le poids exact était ${poids} kg)`);
                await moneyService.gainMoney(guildId, dresseurId, reward);
                collector.stop();
                return;
            }

            // Mauvaise réponse : un indice de direction sans révéler la solution
            const attemptsLeft = gameConfig.guessMyWeightMaxAttempts - collector.collected.size;
            if (attemptsLeft > 0) {
                const indice = isNaN(answer)
                    ? "il te faut un poids en kilogrammes"
                    : (answer < expectedWeight ? "c'est plus lourd" : "c'est plus léger");
                await channelService.replySafe(collected, `❌ Nope ! ${indice} ! Il te reste ${attemptsLeft} essai${attemptsLeft > 1 ? 's' : ''}.`);
                // Relance le compte à rebours pour l'essai suivant
                collector.resetTimer();
            } else {
                await channelService.replySafe(collected, `😵 Damn u suck :c\nThe answer was !${poids} kg`);
                collector.stop();
            }
        });

        collector.on('end', (collected, reason) => {
            if (reason === 'time') {
                channelService.replySafe(message, `⏰ Temps écoulé, tu serais pas un peu guez ? La réponse était ${poids} kg`);
            }
            pendingResponses.delete(responseKey); // Libère la clé
        });
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
            case 'guessMyWeight':
                return rewards.guessMyWeightReward;
            case 'guessMyName':
                return rewards.guessMyNameReward;
            default:
                return 0;
        }
    }
}

export const gameService = new GameService();
