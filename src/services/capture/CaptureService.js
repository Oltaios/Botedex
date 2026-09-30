/**
 * Service de capture de Pokémon
 * Responsabilité : orchestrer le flux de capture complet — vérifier qu'un
 * Pokémon est disponible, demander la ball à utiliser, décompter le stock,
 * tirer le résultat et mettre à jour le Pokédex du dresseur.
 * S'appuie sur BDDService (persistance), InventoryService (stock de balls)
 * et SpawnService (numéro du Pokémon disponible). Toutes les réponses du
 * flux sont envoyées en reply au message de commande de l'utilisateur.
 *
 * Exemple d'utilisation :
 *   import { captureService } from './services/capture/CaptureService.js';
 *   await captureService.gererEventCapture(message, responseKey);
 */

import { bddService } from '../bdd/BDDService.js';
import { moneyService } from '../economy/MoneyService.js'
import { getConfig } from '../../utils/configLoader.js';
import { Ball } from '../../models/Ball.js';
import { setNumPkmAvailable, getNumPkmAvailable } from '../../core/client.js';
import { inventoryService } from '../economy/InventoryService.js';
import  { pendingResponses } from '../../core/client.js'
import { parsingPkm } from '../../utils/parsing.js';
import { channelService } from '../channel/ChannelService.js';


export class CaptureService {
    constructor() {
        this.config = getConfig();
    }

    /**
     * Gère l'événement de capture déclenché par la commande !capture
     * Flux : vérifie qu'un Pokémon est disponible (spawn actif), vérifie que
     * le dresseur possède au moins une ball, affiche son inventaire, attend
     * le choix de la ball (!pokeball/!superball/!hyperball, 15 s max),
     * décompte la ball puis lance le tirage de capture.
     * Toutes les étapes sont envoyées en reply à la commande.
     * À la fin (temps écoulé, choix fait ou limite atteinte), libère la clé
     * de réponse et vide le spawn en cours.
     * @param {Object} message - Message Discord ayant déclenché la commande
     * @param {string} responseKey - Clé de réponse enregistrée dans pendingResponses
     * @returns {Promise<void>}
     */
    async gererEventCapture(message, responseKey){
        //On vérifie qu'un pokémon est prêt à être capturé
        const numPkm = getNumPkmAvailable();
        let pokemonAvailable = parsingPkm(numPkm);
        if(pokemonAvailable != null){
            // Vérifie que le dresseur a de quoi capturer avant de lancer le flux
            const inventory = await inventoryService.getInventory(message.author.id);
            const totalBalls = (inventory.pokeball || 0) + (inventory.superball || 0) + (inventory.hyperball || 0);
            if (totalBalls === 0) {
                await channelService.replySafe(message, "🎒 Tes poches sont vides ! File au shop d'abord avec `!shop` pour t'équiper en balls, le pokémon t'attendra peut-être encore.");
                console.log("[CAPTURE] Appel de capture.js suppression de responseKey : " + responseKey);
                pendingResponses.delete(responseKey);
                return;
            }

            // Inventaire et question regroupés pour ne pinger qu'une seule fois
            const inventoryDisplay = await inventoryService.getInventoryDisplay(message.author.id);
            await channelService.replySafe(message, inventoryDisplay + `\nQuelle pokéball veux-tu utiliser ? Exemple de réponse attendu **!pokeball**`);
            const filter = m => m.author.id === message.author.id &&
                (m.content === '!pokeball' ||
                m.content === '!superball' ||
                m.content === '!hyperball');
            const collector = message.channel.createMessageCollector({ filter, max: 1, time: 15_000 });

            collector.on("collect", async (ballChoiceMessage) => {
                console.log("[CAPTURE] Type de ball à utiliser = " + ballChoiceMessage.content.slice(1));
                if(await bddService.tryToLoseBall(ballChoiceMessage.author.id, ballChoiceMessage.content.slice(1)) == 0){
                    await this.capture(message.author.id, pokemonAvailable[1], ballChoiceMessage.content.slice(1), pokemonAvailable[0], numPkm, message);
                    collector.stop();
                }
                else{
                    // Répond au message de choix : c'est une réaction directe à ce qu'il vient de taper
                    await channelService.replySafe(ballChoiceMessage, "Vous n'avez pas assez de ce type de ball !");
                }
            });

            collector.on("end", () => {
                if (collector.endReason === 'time') {
                    channelService.replySafe(message, `Ça dort ici, temps écoulé ! Fin de la **!capture** !`);
                }
                else if (collector.endReason === 'limit') {
                    channelService.replySafe(message, `Fin de la **!capture** !`);
                }
                console.log("[CAPTURE] Appel de capture.js suppression de responseKey : " + responseKey);
                pendingResponses.delete(responseKey);

                setNumPkmAvailable(null);
            });
        }
        else{
            await channelService.replySafe(message, "Aucun pokémon disponible, reviens plus tard !");
            console.log("[CAPTURE] Appel de capture.js suppression de responseKey : " + responseKey);
            pendingResponses.delete(responseKey);
        }
    }

    /**
     * Lance une tentative de capture
     * Le tirage : rng (0-99) * rate de la ball doit atteindre le seuil
     * 100 - (taux de capture * rate de la ball) / 3
     * @param {string} userId - ID Discord du dresseur
     * @param {string|number} captureRate - Taux de capture de base du Pokémon (issu du CSV)
     * @param {string} ballType - Type de ball utilisé ('pokeball', 'superball', 'hyperball')
     * @param {string} pkmName - Nom du Pokémon visé (pour les messages uniquement)
     * @param {number} numPkm - Numéro du Pokémon (clé de stockage dans le Pokédex du dresseur)
     * @param {Object} commandMessage - Message !capture d'origine, cible des replies
     * @returns {Promise<boolean>} - true si nouveau Pokémon capturé, false sinon (échec du tirage ou déjà capturé)
     */
    async capture(userId, captureRate, ballType, pkmName, numPkm, commandMessage) {
        // Crée la ball utilisée
        const ball = new Ball(ballType);

        // Calcule le taux de capture final (base * rate de la ball)
        const finalCaptureRate = captureRate * ball.getRate();
        const threshold = 100 - (finalCaptureRate / 3); // Même formule que ton code actuel
        const rng = Math.floor(Math.random() * 100);

        console.log(`[CAPTURE] User: ${userId}, Pokémon: ${pkmName}, Ball: ${ballType}, ` +
                  `Rate: ${finalCaptureRate}, RNG: ${rng}, Threshold: ${threshold}`);

        if (rng * ball.getRate() >= threshold) {
            // Succès : Pokémon capturé
            const alreadyCaptured = await bddService.alreadyCaptured(userId, numPkm);

            if (alreadyCaptured) {
                await channelService.replySafe(commandMessage, "Vous avez déjà capturé ce Pokémon, vous décidez de vendre ses organes à la Team Rocket et gagnez 250$, bien joué!");
                moneyService.gainMoney(userId, 250);
                await bddService.incrementCaptureCount(userId);
                return false; // Pokémon déjà capturé
            } else {
                // Nouveau Pokémon !
                await channelService.replySafe(commandMessage, "Nouveau Pokémon ! Mise à jour du Pokédex SHEEEEEEEEEEEEEESH");
                await bddService.registerNewCapture(userId, numPkm);
                return true; // Capture réussie
            }
        } else {
            // Échec : Pokémon non capturé
            await channelService.replySafe(commandMessage, "Le Pokémon s'est échappé ! Mais tu as quand même essayé, c'est déjà ça, loser.");
            return false; // Capture échouée
        }
    }
}

export const captureService = new CaptureService();
