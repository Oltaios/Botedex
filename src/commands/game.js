/**
 * Commande !game
 * Lance un mini-jeu (ex: guessMyType)
 * 
 * Exemple d'utilisation :
 *   import { execute } from './commands/game.js';
 *   await execute(message);
 */

import { Pokemon } from '../models/Pokemon.js';
import { bddService } from '../services/bdd/BDDService.js';
import { gameService } from '../services/game/GameService.js';
import { moneyService } from '../services/economy/MoneyService.js';
import { sendGif } from '../utils/gif.js';
import { parsingPkmNomType1Type2 } from '../utils/parsing.js';
import { pendingResponses } from '../core/client.js';
import { getConfig } from '../utils/configLoader.js';

/**
 * Exécute la commande !game
 * Mini-jeu "guessMyType" : envoie un Pokémon aléatoire (GIF) et le dresseur
 * doit deviner son ou ses types en un nombre limité d'essais et de temps
 * (config game de gameConfig.json). Réponse attendue : "!<type>" ou
 * "!<type1>/<type2>". Le jeton quotidien est consommé dès la première réponse.
 * @param {Object} message - Message Discord ayant déclenché la commande
 * @returns {Promise<void>}
 */
export async function execute(message) {
    const dresseurId = message.author.id;
    const channel = message.channel;

    // Vérifie si le jeu est disponible pour l'utilisateur
    const gameAvailable = await bddService.checkIfAvailable(message.guildId, dresseurId, 'gameAvailable');
    
    if (gameAvailable) {
        // TODO: Intégrer avec gameService
        // Pour l'instant, utilise la logique existante
        const gameConfig = getConfig().game;
        const numPkm = Math.floor(Math.random() * gameConfig.numberOfPokemon) + 1;
        const { nomPoke, type_1, type_2 } = parsingPkmNomType1Type2(numPkm);
        const pkm2Guess = new Pokemon(numPkm, nomPoke, type_1, type_2 || null);
        await sendGif(pkm2Guess.nom + " pokemon", message);
        const reward = gameService.getReward('guessMyType');
        const type1 = pkm2Guess.getType1();
        const type2 = pkm2Guess.getType2();

        console.log(`User ${dresseurId} (${message.author.username}) launched guessMyType and picked ${pkm2Guess.nom} ${type1}${type2 !== null ? `/${type2}` : ''} to guess`);

        await message.reply(
            `🎮 Un dresseur étrange surgit et envoie un ${pkm2Guess.nom}, il te met au défi de trouver son ou ses types ! ` +
            `\nTu as ${gameConfig.guessMyTypeMaxAttempts} essais.` +
            `\n(Ensemble des types : normal / feu /eau / electrik / plante / glace / combat / poison / sol / vol / psy / insecte / roche / spectre / dragon / tenebres / acier / fee )` +
            `\nExemple d'une réponse : **!normal** ou **!normal/roche** (l'ordre en cas de double type n'est pas important)`
        );

        const responseKey = `${message.channel.id}:${message.author.id}`;
        // Marque le joueur comme "en attente de réponse" pour ignorer ses messages dans messageCreate
        pendingResponses.add(responseKey);

        const filter = m => m.author.id === dresseurId && m.content.startsWith("!");
        const collector = channel.createMessageCollector({ filter, max: gameConfig.guessMyTypeMaxAttempts, time: gameConfig.guessMyTypeTimeMs });

        collector.on('collect', async collected => {
            

            // Réponses acceptées : le type seul si monotype, les deux ordres si double type
            const answer = collected.content.slice(1).toLowerCase();
            const expectedAnswers = type2 === null
                ? [type1]
                : [`${type1}/${type2}`, `${type2}/${type1}`];

            // Le jeton est consommé dès la première réponse, gagnant ou perdant
            if (collector.collected.size === 1) {
                await bddService.consumeGameAvailable(message.guildId, dresseurId);
            }

            if (expectedAnswers.includes(answer)) {
                await collected.reply(`🎉 You found it ! Well played ! U gained ${reward} pokédollars !`);
                await moneyService.gainMoney(message.guildId, dresseurId, reward);
                collector.stop();
                return;
            }

            // Mauvaise réponse : on laisse les essais restants sans révéler la solution
            const attemptsLeft = gameConfig.guessMyTypeMaxAttempts - collector.collected.size;
            if (attemptsLeft > 0) {
                await collected.reply(`❌ Nope ! Il te reste ${attemptsLeft} essai${attemptsLeft > 1 ? 's' : ''}.`);
                // Relance le compte à rebours pour l'essai suivant
                collector.resetTimer();
            } else {
                await collected.reply("😵 Damn u suck :c\nThe answer was " + "!" + expectedAnswers[0]);
                collector.stop();
            }
        });

        collector.on('end', (collected, reason) => {
            if (reason === 'time') {
                message.reply(`⏰ Temps écoulé, tu serais pas un peu guez ? La réponse était ${type1}${type2 !== null ? `/${type2}` : ''}`);
            }
            pendingResponses.delete(responseKey); // Libère la clé
        });
    } else {
        await message.reply("🌙 Jeu non disponible, il faut attendre minuit ! Espèce de drogué.");
    }
}

// Metadata pour l'aide automatique
export const metadata = {
    name: 'game',
    description: 'Lance un mini-jeu (devine le type du Pokémon)',
    usage: '!game',
    category: 'Jeux'
};
