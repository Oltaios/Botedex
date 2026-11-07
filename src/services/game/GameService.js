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
import { parsingPkm, parsingPkmAbilities, parsingToutesAbilities, parsingPkmNomType1Type2, parsingPkmNomPoids } from '../../utils/parsing.js';
import { pendingResponses } from '../../core/client.js';
import { dailyEventService } from '../event/DailyEventService.js';

/** Normalise un mot : minuscules, accents retirés (NFD) — pour comparer les lettres */
function normaliserMot(mot) {
    return String(mot).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

/** Normalise une lettre saisie (1 caractère, sans accent) */
function normaliserLettre(l) {
    const n = normaliserMot(l);
    return /^[a-z]$/.test(n) ? n : '';
}

/**
 * Affichage du pendu : lettres trouvées en clair [E], lettres cachées [*],
 * espaces en _ et autres caractères (point, symboles) visibles tels quels
 */
function afficherMot(nom, lettresTrouvees) {
    return [...String(nom)].map((car) => {
        if (car === ' ') return '_';
        const n = normaliserMot(car);
        if (!/^[a-z]$/.test(n)) return car;
        return lettresTrouvees.has(n) ? car.toUpperCase() : ' * ';
    }).join(' ');
}

export class GameService {
    constructor() {
        this.config = getConfig();
        // Jeux disponibles : clé = type saisi par le dresseur (ex: "!type"),
        // description affichée lors du choix, launch = lanceur du jeu
        // (reçoit le type de jeu, clé du jeton horaire en base)
        // Emojis de réponse du quiz "ability" (1 à 4)
        this.EMOJIS_REPONSES = ['1️⃣', '2️⃣', '3️⃣', '4️⃣'];
        // Sessions de quiz "ability" actives, indexées par id du message du bot
        this.sessionsAbilites = new Map();
        this.games = {
            type: {
                description: 'Devine le ou les types d\'un Pokémon',
                launch: (message, gameType) => this.guessMyType(message, gameType)
            },
            poids: {
                description: 'Devine le poids d\'un Pokémon',
                launch: (message, gameType) => this.guessMyWeight(message, gameType)
            },
            nom: {
                description: 'Devine le nom français d\'un Pokémon (pendu)',
                launch: (message, gameType) => this.guessMyName(message, gameType)
            },
            talent: {
                description: 'Devine la capacité (talent) d\'un Pokémon parmi 4 (réaction 1️⃣-4️⃣)',
                launch: (message, gameType) => this.guessMyAbility(message, gameType)
            }
        };
        // Alias rétrocompatibles : anciennes commandes anglaises -> nouvelles clés FR
        this.aliasJeux = { weight: 'poids', name: 'nom', ability: 'talent' };
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

        gameType = this.resoudreJeu(gameType);
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

        // Event quotidien : jouer rapporte des points d'activité
        await dailyEventService.registerActivity(guildId, dresseurId, 'game');

        await this.games[gameType].launch(message, gameType);
    }

    /**
     * Liste les jeux pour l'affichage (une ligne par jeu)
     * @param {Object} [jeux=this.games] - Jeux à lister (tous par défaut)
     * @returns {string}
     */
    /**
     * Résout un type de jeu saisi vers sa clé actuelle (alias EN -> FR)
     * @param {string} gameType - Type saisi (ex: 'weight' ou 'poids')
     * @returns {string} - Clé actuelle du jeu (ex: 'poids')
     */
    resoudreJeu(gameType) {
        return this.aliasJeux?.[gameType] ?? gameType;
    }

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
            const gameType = this.resoudreJeu(collected.content.slice(1).toLowerCase());
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
            // Passe par lancerJeu (et non game.launch directement) pour que le
            // choix différé enregistre aussi les points d'activité de l'event quotidien
            await this.lancerJeu(message, gameType);
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
        await sendGif(pkm2Guess.nom, message);
        const reward = this.getReward('guessMyType');
        const type1 = pkm2Guess.getType1();
        const type2 = pkm2Guess.getType2();

        console.log(`User ${dresseurId} (${message.author.username}) launched guessMyType and picked ${nomPokeFR} ${type1}${type2 !== null ? `/${type2}` : ''} to guess`);

        await channelService.replySafe(message,
            `🎮 Un dresseur étrange surgit et envoie un ${nomPokeFR}, il te met au défi de trouver son ou ses types ! ` +
            `\nTu as ${gameConfig.guessMyTypeMaxAttempts} essais.` +
            `\n(Ensemble des types : normal / feu /eau / electrik / plante / glace / combat / poison / sol / vol / psy / insecte / roche / spectre / dragon / acier / fee )` +
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
        const { nomPokeENG, poids, nomPokeFR } = parsingPkmNomPoids(numPkm);
        await sendGif(nomPokeENG, message);
        const reward = this.getReward('guessMyWeight');
        const expectedWeight = parseFloat(poids);
        const marge = expectedWeight * gameConfig.guessMyWeightTolerance;
        const margePourcent = Math.round(gameConfig.guessMyWeightTolerance * 100);

        console.log(`User ${dresseurId} (${message.author.username}) launched guessMyWeight and picked ${nomPokeFR} ${poids} kg to guess (tolérance ±${marge} kg)`);

        await channelService.replySafe(message,
            `🎮 Un dresseur étrange surgit et envoie un ${nomPokeFR}, il te met au défi d'estimer son poids ! ` +
            `\nTu as ${gameConfig.guessMyWeightMaxAttempts} essais.` +
            `\nUne marge de ±${margePourcent} % autour du poids réel est acceptée.` +
            `\n\nExemple d'une réponse : \`<!6.9>\` ou \`<!6,9>\` (en kilogrammes, séparateur point ou virgule)`
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
     * Mini-jeu "guessMyName" (pendu) : le dresseur devine le NOM FRANÇAIS d'un
     * Pokémon aléatoire. Une voyelle est offerte au départ (toutes ses
     * occurrences sont révélées), puis chaque proposition "!<lettre>" révèle
     * toutes les occurrences de la lettre ; les lettres cachées sont affichées
     * [*]. Erreurs max : guessMyNameMaxErrors (2) — à la 3e erreur le jeu
     * s'arrête sans gain. Nom complet trouvé -> guessMyNameReward (50 $).
     * Le jeton horaire est consommé dès la première réponse.
     * @param {Object} message - Message Discord ayant déclenché le jeu
     * @param {string} gameType - Type de jeu (clé du jeton horaire en base)
     * @returns {Promise<void>}
     */
    async guessMyName(message, gameType) {
        const dresseurId = message.author.id;
        const guildId = message.guildId;
        const gameConfig = this.config.game;

        const numPkm = Math.floor(Math.random() * gameConfig.numberOfPokemon) + 1;
        const nomPokeFR = parsingPkm(numPkm)[2];
        const reward = this.getReward('guessMyName');
        const maxErrors = gameConfig.guessMyNameMaxErrors ?? 2;

        // Lettres du mot (minuscules, sans accents) ; une voyelle offerte au départ
        const lettresMot = [...normaliserMot(nomPokeFR)].filter((c) => /[a-z]/.test(c));
        const voyelles = [...new Set(lettresMot.filter((c) => 'aeiouy'.includes(c)))];
        const lettresTrouvees = new Set();
        if (voyelles.length > 0) {
            lettresTrouvees.add(voyelles[Math.floor(Math.random() * voyelles.length)]);
        }
        const proposees = new Set(lettresTrouvees); // la voyelle offerte est déjà connue
        let erreurs = 0;

        console.log(`User ${dresseurId} (${message.author.username}) launched guessMyName and picked ${nomPokeFR} [${numPkm}]`);

        await channelService.replySafe(message,
            `🎮 **Pendu !** Devine le nom français du Pokémon : ${afficherMot(nomPokeFR, lettresTrouvees)}\n` +
            `Une voyelle est offerte. Propose une lettre avec **!e** (exemple). ${maxErrors} erreurs max avant la défaite. À gagner : **${reward}$** !`
        );

        const responseKey = `${message.channel.id}:${dresseurId}`;
        // Marque le joueur comme "en attente de réponse" pour ignorer ses messages dans messageCreate
        pendingResponses.add(responseKey);

        const filter = (m) => m.author.id === dresseurId && /^![a-zàâäéèêëîïôöùûüç]$/i.test(m.content);
        const collector = message.channel.createMessageCollector({ filter, time: gameConfig.guessMyNameTimeMs ?? 30000 });

        const motTrouve = () => lettresMot.every((c) => lettresTrouvees.has(c));

        collector.on('collect', async (collected) => {
            // Le jeton est consommé dès la première réponse, gagnant ou perdant
            if (collector.collected.size === 1) {
                await bddService.recordGamePlayed(guildId, dresseurId, gameType, new Date());
            }
            const lettre = normaliserLettre(collected.content.slice(1));
            if (!lettre) {
                await channelService.replySafe(collected, "❌ Une seule lettre à la fois, ex: **!e**");
                collector.resetTimer();
                return;
            }
            if (proposees.has(lettre)) {
                await channelService.replySafe(collected, `La lettre ${lettre.toUpperCase()} a déjà été proposée : ${afficherMot(nomPokeFR, lettresTrouvees)}`);
                collector.resetTimer();
                return;
            }
            proposees.add(lettre);

            if (lettresMot.includes(lettre)) {
                lettresTrouvees.add(lettre);
                if (motTrouve()) {
                    await channelService.replySafe(collected, `🎉 Bravo ! C'était bien **${nomPokeFR}** ! Tu gagnes ${reward} pokédollars !`);
                    await moneyService.gainMoney(guildId, dresseurId, reward);
                    await sendGif(parsingPkm(numPkm)[0], message); // sticker de révélation
                    collector.stop();
                    return;
                }
                await channelService.replySafe(collected, `✅ Bonne lettre : ${afficherMot(nomPokeFR, lettresTrouvees)} (encore ${maxErrors + 1 - erreurs} erreur(s) autorisée(s))`);
            } else {
                erreurs++;
                if (erreurs > maxErrors) {
                    await channelService.replySafe(collected, `💀 3e erreur, c'est perdu ! Le Pokémon était **${nomPokeFR}** — aucun gain.`);
                    await sendGif(parsingPkm(numPkm)[0], message); // sticker de révélation
                    collector.stop();
                    return;
                }
                await channelService.replySafe(collected, `❌ ${lettre.toUpperCase()} n'est pas dans le nom : ${afficherMot(nomPokeFR, lettresTrouvees)} — ${maxErrors + 1 - erreurs} erreur(s) restante(s) avant la défaite.`);
            }
            collector.resetTimer();
        });

        collector.on('end', (collected, reason) => {
            if (reason === 'time') {
                channelService.replySafe(message, `⏰ Temps écoulé ! Le Pokémon était **${nomPokeFR}**.`);
            }
            pendingResponses.delete(responseKey); // Libère la clé
        });
    }

    /**
     * Mini-jeu "guessMyAbility" : 4 capacités sont tirées au sort (dont une est
     * celle du Pokémon affiché) ; le dresseur répond en cliquant sur la réaction
     * 1️⃣-4️⃣ posée par le bot sur le message du quiz. Bonne réponse ->
     * guessMyAbilityReward. Jeton horaire consommé au premier clic.
     * @param {Object} message - Message Discord ayant déclenché le jeu
     * @param {string} gameType - Type de jeu (clé du jeton horaire en base)
     * @returns {Promise<void>}
     */
    async guessMyAbility(message, gameType) {
        const dresseurId = message.author.id;
        const guildId = message.guildId;
        const gameConfig = this.config.game;

        const numPkm = Math.floor(Math.random() * gameConfig.numberOfPokemon) + 1;
        const [nomPokeENG, , nomPokeFR] = parsingPkm(numPkm);
        const capacitesPkm = parsingPkmAbilities(numPkm);
        const reward = this.getReward('guessMyAbility');

        if (capacitesPkm.length === 0) {
            await channelService.replySafe(message, "❌ Ce Pokémon n'a pas de capacité connue, partie annulée.");
            return;
        }

        // La bonne réponse : une capacité du Pokémon ; 3 distracteurs distincts tirés dans le pool global
        const bonne = capacitesPkm[Math.floor(Math.random() * capacitesPkm.length)];
        const pool = parsingToutesAbilities().filter((a) => a !== bonne);
        const distracteurs = [];
        while (distracteurs.length < 3 && pool.length > 0) {
            distracteurs.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
        }
        // Mélange des 4 options
        const options = [bonne, ...distracteurs];
        for (let i = options.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [options[i], options[j]] = [options[j], options[i]];
        }
        const bonneIndex = options.indexOf(bonne);

        console.log(`User ${dresseurId} (${message.author.username}) launched guessMyAbility and picked ${nomPokeFR} [${numPkm}] (bonne réponse: ${bonne})`);

        // Sticker du Pokémon (comme les autres jeux), puis le quiz avec ses réactions
        await sendGif(nomPokeENG + ' @pokemon', message);

        const listeOptions = options.map((c, i) => `${this.EMOJIS_REPONSES[i]} ${c}`).join('\n'); // talents déjà en français dans le CSV
        const texte =
            `🎮 **Quelle est la capacité de ${nomPokeFR} ?**\n${listeOptions}\n` +
            `Réponds en cliquant sur la réaction correspondante. Gain : **${reward}$** !`;
        const msgJeu = await channelService.replySafe(message, texte);
        if (!msgJeu || typeof msgJeu.react !== 'function') return;
        for (const emoji of this.EMOJIS_REPONSES) {
            await msgJeu.react(emoji).catch((e) => console.warn('[GAME] react impossible :', e.message));
        }

        // Session : indexée par l'id du message du quiz, jusqu'à la réponse ou au timeout
        const responseKey = `${message.channel.id}:${dresseurId}`;
        pendingResponses.add(responseKey);
        const session = {
            guildId,
            userId: dresseurId,
            channelId: message.channel.id,
            numPkm,
            nomPokeFR,
            options,
            bonneIndex,
            repondu: false
        };
        session.timer = setTimeout(() => {
            this.terminerSessionAbility(msgJeu.id, `⏰ Temps écoulé ! La capacité de **${nomPokeFR}** était **${options[bonneIndex]}**.`);
        }, gameConfig.guessMyAbilityTimeMs ?? 30000);
        this.sessionsAbilites.set(msgJeu.id, session);
    }

    /**
     * Traite une réaction emoji sur un message de quiz "ability"
     * @param {Object} reaction - Réaction discord.js (reaction.emoji.name, reaction.message.id)
     * @param {Object} user - Auteur de la réaction
     * @returns {Promise<void>}
     */
    async handleReaction(reaction, user) {
        const session = this.sessionsAbilites.get(reaction.message?.id);
        if (!session) return; // pas un quiz actif
        if (user.id !== session.userId) return; // seul le joueur de la partie répond
        const index = this.EMOJIS_REPONSES.indexOf(reaction.emoji?.name);
        if (index === -1 || session.repondu) return; // emoji hors quiz ou déjà répondu

        session.repondu = true;
        clearTimeout(session.timer);
        // Le jeton horaire est consommé au premier clic
        await bddService.recordGamePlayed(session.guildId, session.userId, 'talent', new Date());

        const bonne = session.options[session.bonneIndex]; // en français (CSV traduit)
        const ok = index === session.bonneIndex;
        const reward = this.getReward('guessMyAbility');
        if (ok) {
            await moneyService.gainMoney(session.guildId, session.userId, reward);
            await channelService.sendMessage(`🎉 Bravo <@${session.userId}> ! La capacité de **${session.nomPokeFR}** est bien **${bonne}** : +${reward}$ !`);
        } else {
            await channelService.sendMessage(`❌ Raté <@${session.userId}> ! La capacité de **${session.nomPokeFR}** était **${bonne}**. Aucun gain.`);
        }

        this.sessionsAbilites.delete(reaction.message.id);
        pendingResponses.delete(`${session.channelId}:${session.userId}`);
    }

    /**
     * Termine une session de quiz "ability" (timeout) : révèle la réponse et nettoie
     * @param {string} msgId - Id du message du quiz
     * @param {string} texte - Message de fin à envoyer
     * @returns {Promise<void>}
     */
    async terminerSessionAbility(msgId, texte) {
        const session = this.sessionsAbilites.get(msgId);
        if (!session || session.repondu) return;
        session.repondu = true;
        this.sessionsAbilites.delete(msgId);
        pendingResponses.delete(`${session.channelId}:${session.userId}`);
        await channelService.sendMessage(texte);
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
            case 'guessMyAbility':
                return rewards.guessMyAbilityReward ?? 50;
            default:
                return 0;
        }
    }
}

export const gameService = new GameService();
