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
import { setNumPkmAvailable, getNumPkmAvailable, setLockPkmAvailable, setTentativesCapture, getTentativesCapture, addTentativesCapture } from '../../core/client.js';
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
     * le choix de la ball (!pokeball/!superball/!hyperball, 15 s max,
     * décompte la ball puis lance le tirage de capture.
     * Toutes les étapes sont envoyées en reply à la commande.
     * À la fin (temps écoulé ou ball effectivement décomptée), libère la clé de réponse
     * @param {Object} message - Message Discord ayant déclenché la commande
     * @param {string} responseKey - Clé de réponse enregistrée dans pendingResponses
     * @returns {Promise<void>}
     */
    async gererEventCapture(message, responseKey){
        // Serveur Discord : partie guildId de la clé composite des dresseurs
        const guildId = message.guildId;
        //On vérifie qu'un pokémon est prêt à être capturé
        const numPkm = getNumPkmAvailable();
        let pokemonAvailable = parsingPkm(numPkm);
        if(pokemonAvailable != null){
            // Vérifie que le dresseur a de quoi capturer avant de lancer le flux
            const inventory = await inventoryService.getInventory(guildId, message.author.id);
            const totalBalls = (inventory.pokeball || 0) + (inventory.superball || 0) + (inventory.hyperball || 0);
            if (totalBalls === 0) {
                await channelService.replySafe(message, "🎒 Tes poches sont vides ! File au shop d'abord avec `!shop` pour t'équiper en balls, le pokémon t'attendra peut-être encore.");
                console.log("[CAPTURE] Appel de capture.js suppression de responseKey : " + responseKey);
                pendingResponses.delete(responseKey);
                setLockPkmAvailable(0); // Le spawn reste actif : re-capturable
                return;
            }

            // Inventaire et question regroupés pour ne pinger qu'une seule fois
            const inventoryDisplay = await inventoryService.getInventoryDisplay(guildId, message.author.id);
            await channelService.replySafe(message, inventoryDisplay + `\nQuelle pokéball veux-tu utiliser ? Exemple de réponse attendu **!pokeball**`);
            const filter = m => m.author.id === message.author.id &&
                (m.content === '!pokeball' ||
                m.content === '!superball' ||
                m.content === '!hyperball');
            // Un choix de type épuisé n'arrête pas la capture, l'utilisateur peut retenter un autre type dans le temps restant
            const collector = message.channel.createMessageCollector({ filter, time: 15_000 });
            // Garde-fou anti double tir : deux messages de choix quasi
            // simultanés ne doivent pas consommer deux balls
            let captureDone = false;

            //Collecteur de choix de ball
            collector.on("collect", async (ballChoiceMessage) => {
                if (captureDone) return;
                captureDone = true;
                collector.resetTimer();
                console.log("[CAPTURE] Type de ball à utiliser = " + ballChoiceMessage.content.slice(1));

                if(await bddService.tryToLoseBall(guildId, ballChoiceMessage.author.id, ballChoiceMessage.content.slice(1)) == 0){
                    //L'utilisateur a pu utiliser une ball, son essai est consommé
                    await addTentativesCapture(message.author.id);
                    collector.resetTimer();
                    const reussiteCapture = await this.capture(message.author.id, pokemonAvailable[1], ballChoiceMessage.content.slice(1), pokemonAvailable[2], numPkm, message);
                    
                    //Le lancer a pu être effectué, succès ou échec à contrôler
                    await channelService.replySafe(message, ".", 1000);
                    await channelService.replySafe(message, "..", 1000);
                    await channelService.replySafe(message, "...", 1000);

                    if(reussiteCapture){
                        // Succès : Pokémon capturé
                        //On reset les flags de capture
                        setNumPkmAvailable(null);
                        setLockPkmAvailable(null);
                        const alreadyCaptured = await bddService.alreadyCaptured(guildId, message.author.id, numPkm);
                                
                        if (alreadyCaptured) {
                            const reventeReward = this.config.economy.duplicateCaptureReward;
                            // Pokémon déjà capturé
                            await channelService.replySafe(message, `**Clic !**\nVous avez déjà capturé ce Pokémon, vous décidez de vendre ses organes à la Team Rocket et gagnez ${reventeReward}$, bien joué!`);
                            moneyService.gainMoney(guildId, message.author.id, reventeReward);
                            await bddService.incrementCaptureCount(guildId, message.author.id);
                             
                        } else {
                            // Nouveau Pokémon !
                            await channelService.replySafe(message, `**Clic !**\nNouveau Pokémon ! Mise à jour du Pokédex SHEEEEEEEEEEEEEESH`);
                            await bddService.registerNewCapture(guildId, message.author.id, numPkm);
                        }
                                    
                    }
                    else{
                        // Échec : Pokémon non capturé
                        await channelService.replySafe(message, "Le Pokémon s'est échappé ! Mais tu as quand même essayé, c'est déjà ça, loser. Place au suivant !");
                        setLockPkmAvailable(0); //On libère le lock du pokémon
                    }
                    //Declenche la fin de la capture
                    collector.stop();
                }
                else{
                    // Ball épuisée : la capture continue, l'utilisateur peut
                    // retenter un autre type dans le temps restant
                    captureDone = false;
                    // Ré-affiche l'inventaire pour guider le nouveau choix
                    const inventoryDisplay = await inventoryService.getInventoryDisplay(guildId, ballChoiceMessage.author.id);
                    await channelService.replySafe(ballChoiceMessage, `Vous n'avez pas assez de ce type de ball !
                    ${inventoryDisplay}`);
                }
            });

            collector.on("end", () => {
                if (collector.endReason === 'time') {
                    channelService.replySafe(message, `Ça dort ici, temps écoulé ! Fin de la **!capture** !`);
                    //On reset les flags de capture
                    setLockPkmAvailable(0); //On libère le lock du pokémon
                }
                console.log("[CAPTURE] Appel de capture.js suppression de responseKey : " + responseKey);
                pendingResponses.delete(responseKey);
            });
        }
        else{
            await channelService.replySafe(message, "Aucun pokémon disponible, reviens plus tard !");
            console.log("[CAPTURE] Appel de capture.js suppression de responseKey : " + responseKey);
            pendingResponses.delete(responseKey);
            setLockPkmAvailable(null); // Aucun spawn actif
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
     * @returns {Promise<boolean>} - true si nouveau Pokémon capturé, false sinon (échec du tirage)
     */
    async capture(userId, captureRate, ballType, pkmName, numPkm, commandMessage) {
        // Crée la ball utilisée
        const ball = new Ball(ballType);

        // Calcule le taux de capture final (base * rate de la ball)
        const finalCaptureRate = captureRate * ball.getRate();
        const threshold = 100 - (finalCaptureRate / 3);
        const rng = Math.floor(Math.random() * 100);

        console.log(`[CAPTURE] User: ${userId}, Pokémon: ${pkmName}, Ball: ${ballType}, ` +
                  `Rate: ${finalCaptureRate}, RNG: ${rng}, Threshold: ${threshold}`);

        
        // Commentaire de lancer selon la qualité du tirage (rng 0-99)
        switch (true) {
            case rng >= 90:
                await channelService.replySafe(commandMessage, `En grandes pompes, tu lances ta ball avec une confiance remarquable, digne des plus grands dresseurs (RNG = ${rng})`);
                break;
            case rng >= 50:
                await channelService.replySafe(commandMessage, `Tu saisis ta ball et tu réalises un beau lancer ! (RNG = ${rng})`);
                break;
            case rng >= 10:
                await channelService.replySafe(commandMessage, `Aïe, le lancer part de travers, la ball frôle le Pokémon... (RNG = ${rng})`);
                break;
            default:
                await channelService.replySafe(commandMessage, `Tu t'élances avec ta ball, mais une envie pressante se fait sentir... (RNG = ${rng})`);
                break;
        }

        if (rng * ball.getRate() >= threshold) {
            return true; //Succès capture
        } else {
            return false; // Capture échouée
        }
    }
}

export const captureService = new CaptureService();
