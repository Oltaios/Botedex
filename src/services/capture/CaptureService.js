/**
 * Service de capture de Pokémon
 * Responsabilité : orchestrer le flux de capture complet — vérifier qu'un
 * Pokémon est disponible, vérifier le stock de balls du dresseur, puis
 * soit demander la ball à utiliser (!capture seul), soit utiliser
 * directement la ball passée en raccourci (!capture <ball>) ; décompter le
 * stock, tirer le résultat et mettre à jour le Pokédex du dresseur.
 * S'appuie sur BDDService (persistance), InventoryService (stock de balls)
 * et SpawnService (numéro du Pokémon disponible). Toutes les réponses du
 * flux sont envoyées en reply au message de commande de l'utilisateur.
 *
 * Exemple d'utilisation :
 *   import { captureService } from './services/capture/CaptureService.js';
 *   await captureService.gererEventCapture(message, responseKey);
 *   await captureService.gererEventCapture(message, responseKey, 'pokeball');
 */

import { bddService } from '../bdd/BDDService.js';
import { moneyService } from '../economy/MoneyService.js'
import { getConfig } from '../../utils/configLoader.js';
import { Ball } from '../../models/Ball.js';
import { setNumPkmAvailable, getNumPkmAvailable, setLockPkmAvailable, addTentativesCapture } from '../../core/client.js';
import { inventoryService } from '../economy/InventoryService.js';
import  { pendingResponses } from '../../core/client.js'
import { parsingPkm } from '../../utils/parsing.js';
import { PhrasesAleatoires } from '../../utils/phrasesAleatoires.js';
import { channelService } from '../channel/ChannelService.js';


export class CaptureService {
    constructor() {
        this.config = getConfig();
        // Pools de phrases pour varier les issues de capture
        // Chaque variante garde le mot-clé attendu par les tests d'intégration
        this.messagesEchec = new PhrasesAleatoires([
            "Le {nomPoke} s'est échappé ! Mais tu as quand même essayé, c'est déjà ça, loser. Place au suivant !",
            "Aïe, le {nomPoke} s'est échappé en te narguant ! La ball, elle, était parfaite, tu es donc bien le seul problème. Place au suivant !",
            "Le {nomPoke} s'est échappé d'un petit saut nonchalant. Il semblerait que tu ne saches même pas lancer une ball ? Place au suivant !"
        ], [
            "Le {nomPoke} s'est échappé, et le Professeur Chen détourne le regard, honteux de ta performance. Place au suivant !"
        ]);
        this.messagesNouveau = new PhrasesAleatoires([
            "**Clic !**\nNouveau Pokémon ! {nomPoke} rejoint ton Pokédex, SHEEEEEEEEEEEEEESH",
            "**Clic !**\nNouveau Pokémon enregistré ! {nomPoke}, ravi de faire ta connaissance !",
            "**Clic !**\nNouveau Pokémon dans la collection : {nomPoke} n'a pas vu ta ball venir !"
        ], [
            "**Clic !**\nNouveau Pokémon ! {nomPoke} rejoint ton Pokédex, 67 ou quoi la team ? "
        ]);
        this.messagesDoublon = new PhrasesAleatoires([
            "**Clic !**\nVous avez déjà capturé ce {nomPoke}, vous décidez de vendre ses organes à la Team Rocket et gagnez {reward}$, bien joué !",
            "**Clic !**\nDoublon de {nomPoke} ! La Team Rocket rachète le second à {reward}$, affaire classée.",
            "**Clic !**\nEncore un {nomPoke}... La Team Rocket envoie un conteneur frigorifique et te file {reward}$ pour ta discrétion."
        ]);
    }

    /**
     * Liste les types de ball du jeu pour l'affichage (config balls)
     * @returns {string}
     */
    listerBalls() {
        return Object.keys(this.config.balls)
            .map((ball) => `**!${ball}**`)
            .join(' / ');
    }

    /**
     * Résout une saisie utilisateur vers le type de ball de la config,
     * sans sensibilité à la casse : "!capture maitreball" trouve "MaitreBall"
     * @param {string} saisie - Type de ball saisi par le dresseur
     * @returns {string|null} - Clé exacte de la config balls, ou null si inconnue
     */
    resoudreBallType(saisie) {
        const saisieMinuscule = String(saisie).toLowerCase();
        return Object.keys(this.config.balls)
            .find(ballType => ballType.toLowerCase() === saisieMinuscule) ?? null;
    }

    /**
     * Gère l'événement de capture déclenché par la commande !capture
     * Deux usages :
     * - "!capture <ball>" (ballType fourni) : capture directe avec la ball
     *   choisie, sans question
     * - "!capture" (ballType absent) : affiche l'inventaire du dresseur,
     *   attend le choix de la ball (!<ball>, 15 s max)
     * Dans les deux cas : vérifie qu'un Pokémon est disponible (spawn actif)
     * et que le dresseur possède au moins une ball, puis décompte la ball
     * et lance le tirage de capture. Toutes les étapes sont envoyées en
     * reply à la commande.
     * À la fin (temps écoulé ou tentative effectuée), libère la clé de réponse
     * @param {Object} message - Message Discord ayant déclenché la commande
     * @param {string} responseKey - Clé de réponse enregistrée dans pendingResponses
     * @param {string|null} [ballType=null] - Type de ball du raccourci
     *        (clé de la config balls, ex: 'pokeball'), ou null en mode question
     * @returns {Promise<void>}
     */
    async gererEventCapture(message, responseKey, ballType = null){
        // Serveur Discord : partie guildId de la clé composite des dresseurs
        const guildId = message.guildId;
        //On vérifie qu'un pokémon est prêt à être capturé
        const numPkm = getNumPkmAvailable();
        let pokemonAvailable = parsingPkm(numPkm);
        if(pokemonAvailable != null){
            // Vérifie que le dresseur a de quoi capturer avant de lancer le flux
            const inventory = await inventoryService.getInventory(guildId, message.author.id);
            const totalBalls = Object.keys(this.config.balls)
                .reduce((sum, ballType) => sum + (inventory[ballType] || 0), 0);
            if (totalBalls === 0) {
                await channelService.replySafe(message, "🎒 Tes poches sont vides ! File au shop d'abord avec `!shop` pour t'équiper en balls, le pokémon t'attendra peut-être encore.");
                console.log("[CAPTURE] Appel de capture.js suppression de responseKey : " + responseKey);
                pendingResponses.delete(responseKey);
                setLockPkmAvailable(0); // Le spawn reste actif : re-capturable
                return;
            }

            // Mode raccourci "!capture <ball>" : capture directe sans question
            if (ballType !== null) {
                // Résout la saisie vers la clé exacte de la config, sans
                // sensibilité à la casse ("maitreball" -> "MaitreBall")
                ballType = this.resoudreBallType(ballType);
                if (!this.config.balls[ballType]) {
                    await channelService.replySafe(message, `Je ne connais pas ce type de ball ! Balls disponibles :\n${this.listerBalls()}`);
                    console.log("[CAPTURE] Type de ball inconnu : " + ballType);
                    pendingResponses.delete(responseKey);
                    setLockPkmAvailable(0); // Le spawn reste actif : re-capturable
                    return;
                }

                console.log(`[CAPTURE] Raccourci !capture ${ballType} par ${message.author.id}`);
                const lance = await this.effectuerCapture(message, guildId, numPkm, pokemonAvailable, ballType);
                if (!lance) {
                    // Ball épuisé : pas de question ouverte, le lock est libéré
                    setLockPkmAvailable(0); // Le spawn reste actif : re-capturable
                }
                console.log("[CAPTURE] Appel de capture.js suppression de responseKey : " + responseKey);
                pendingResponses.delete(responseKey);
                return;
            }

            // Mode question "!capture" : inventaire et question regroupés
            // pour ne pinger qu'une seule fois
            const inventoryDisplay = await inventoryService.getInventoryDisplay(guildId, message.author.id);
            await channelService.replySafe(message, inventoryDisplay + `\nQuelle pokéball veux-tu utiliser ? Exemple de réponse attendu **!pokeball**`);
            const ballsConnues = Object.keys(this.config.balls);
            // Insensible à la casse : "MaitreBall" se tape aussi "!maitreball"
            const filter = m => m.author.id === message.author.id &&
                ballsConnues.some(ball => m.content.toLowerCase() === `!${ball.toLowerCase()}`);
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
                const ballChoisie = ballChoiceMessage.content.slice(1);
                console.log("[CAPTURE] Type de ball à utiliser = " + ballChoisie);

                const lance = await this.effectuerCapture(message, guildId, numPkm, pokemonAvailable, ballChoisie, ballChoiceMessage);
                if (lance) {
                    //Déclenche la fin de la capture
                    collector.stop();
                }
                else{
                    // Ball épuisée : la capture continue, l'utilisateur peut
                    // retenter un autre type dans le temps restant
                    captureDone = false;
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
     * Exécute une tentative de capture avec la ball choisie : décompte la
     * ball, effectue le tirage, gère le suspens puis l'issue (nouveau
     * Pokémon, doublon revendu ou échappé). Les messages sont envoyés en
     * reply au message de commande ; le refus "pas assez de ce type" est
     * envoyé au message de choix de ball s'il existe (mode question),
     * sinon à la commande.
     * @param {Object} message - Message de la commande !capture, cible des replies
     * @param {string} guildId - ID du serveur Discord (isolation des données)
     * @param {number} numPkm - Numéro du Pokémon visé (spawn actif)
     * @param {Array} pokemonAvailable - Données du Pokémon visé (sortie de parsingPkm)
     * @param {string} ballType - Type de ball utilisé (clé de la config balls)
     * @param {Object|null} [ballChoiceMessage=null] - Message de choix de ball
     *        (mode question), cible du refus si le stock est insuffisant
     * @returns {Promise<boolean>} - true si la tentative a été effectuée
     *          (ball décomptée), false si le stock de ce type est insuffisant
     */
    async effectuerCapture(message, guildId, numPkm, pokemonAvailable, ballType, ballChoiceMessage = null) {
        const userId = message.author.id;

        if(await bddService.tryToLoseBall(guildId, userId, ballType) !== 0){
            // Ball épuisée : le dresseur peut retenter un autre type
            // Ré-affiche l'inventaire pour guider le nouveau choix
            const inventoryDisplay = await inventoryService.getInventoryDisplay(guildId, userId);
            await channelService.replySafe(ballChoiceMessage ?? message, `Vous n'avez pas assez de ce type de ball !
                    ${inventoryDisplay}`);
            return false;
        }

        //L'utilisateur a pu utiliser une ball, son essai est consommé
        await addTentativesCapture(userId);
        const reussiteCapture = await this.capture(userId, pokemonAvailable[1], ballType, pokemonAvailable[2], numPkm, message);

        //Le lancer a pu être effectué, succès ou échec à contrôler
        //Suspens : en cas d'échec, le nombre de points avant le
        //résultat est aléatoire (1 à 3) ; un succès garde les trois
        const nbPoints = reussiteCapture ? 3 : Math.floor(Math.random() * 3) + 1;
        for (let i = 1; i <= nbPoints; i++) {
            await channelService.replySafe(message, ".".repeat(i), 1000);
        }

        if(reussiteCapture){
            // Succès : Pokémon capturé
            //On reset les flags de capture
            setNumPkmAvailable(null);
            setLockPkmAvailable(null);
            const alreadyCaptured = await bddService.alreadyCaptured(guildId, userId, numPkm);

            if (alreadyCaptured) {
                const reventeReward = this.config.economy.duplicateCaptureReward;
                // Pokémon déjà capturé
                await channelService.replySafe(message, this.messagesDoublon.piocher({ nomPoke: pokemonAvailable[2], reward: reventeReward }));
                moneyService.gainMoney(guildId, userId, reventeReward);
                await bddService.incrementCaptureCount(guildId, userId);

            } else {
                // Nouveau Pokémon !
                await channelService.replySafe(message, this.messagesNouveau.piocher({ nomPoke: pokemonAvailable[2] }));
                await bddService.registerNewCapture(guildId, userId, numPkm);
            }
        }
        else{
            // Échec : Pokémon non capturé
            await channelService.replySafe(message, this.messagesEchec.piocher({ nomPoke: pokemonAvailable[2] }));
            setLockPkmAvailable(0); //On libère le lock du pokémon
        }
        return true;
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
