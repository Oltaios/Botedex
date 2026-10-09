/**
 * Gestionnaire de l'événement 'messageCreate' (nouveau message)
 * Route les messages vers les commandes appropriées
 * 
 * Exemple d'utilisation :
 *   import { handle } from './events/messageCreate.js';
 *   client.on('messageCreate', handle);
 */

import { client, pendingResponses } from '../core/client.js';
import { bddService } from '../services/bdd/BDDService.js';
import * as commands from '../commands/index.js';
import { channelService } from '../services/channel/ChannelService.js';

/**
 * Gère l'événement 'messageCreate' de Discord : routeur principal des commandes
 * Ordre de traitement :
 * 1. Ignore les messages du bot lui-même
 * 2. N'écoute que le channel principal du bot (channelService.channelId)
 * 3. Ignore l'auteur d'une réponse en attente (pendingResponses)
 * 4. Commandes sans enregistrement : !ping, !help, !admin (permission par
 *    liste d'IDs de la config), !jeVeuxJouer... (création de compte)
 * 5. Commandes réservées aux dresseurs enregistrés (vérification BDD) via un switch
 * @param {Object} message - Message Discord reçu
 * @returns {Promise<void>}
 */
export async function handle(message) {
    // 1. Ignore les messages du bot lui-même
    if (message.author.id === client.user.id) {
        console.log('🤖 Message envoyé par le bot - ignoré');
        return;
    }

    // 2. N'écoute que le channel principal du bot
    if (message.channel.id !== channelService.channelId) {
        return;
    }
    
    // 3. Ignore les réponses aux collectors
    const hasPendingCommand = Array.from(pendingResponses).some(key => key.endsWith(message.author.id));
    if (hasPendingCommand) return;

    // 4. Commandes sans vérification d'enregistrement
    if (message.content === '!ping') {
        await commands.ping.execute(message);
        return;
    }

    if (message.content === '!help') {
        await commands.help.execute(message);
        return;
    }

    // !admin : permission basée sur la liste d'IDs de la config (pas sur un
    // compte enregistré) — routée avant la vérification d'enregistrement
    if (message.content === '!admin' || message.content.startsWith('!admin ')) {
        await commands.admin.execute(message);
        return;
    }
    
    // 5. Commande d'enregistrement
    if (message.content === '!jeVeuxJouerStpCreeMoiUnComptePourquoiCetteCommandeEstSiLongueJeHaisLesDevs') {
        const existe = await bddService.validerRegleGestionUtilisateurEnregistre(message.guildId, message.author.id);
        if (existe) {
            await channelService.replySafe(message, "User already exists tu me prends pour un artichaut ?");
        } else {
            await channelService.replySafe(message, "Wanna create an account, if you used ctrl-c + ctrl-v to enter the command u'll find Magikarp only");
            try {
                await bddService.createNewUser(message.guildId, message.author.id, message.author.username);
                await channelService.replySafe(message, `Compte créé ! Tu peux accéder aux différentes commandes via **!help**`);
            } catch (error) {
                console.error('❌ Erreur lors de la création de l\'utilisateur:', error);
                await channelService.replySafe(message, "Une erreur est survenue lors de la création de ton compte. Merci d'embêter votre admin.");
            }
        }
        return;
    }

    // 6. Commandes nécessitant un utilisateur enregistré
    if (message.content.startsWith('!')) {
        const isRegistered = await bddService.validerRegleGestionUtilisateurEnregistre(message.guildId, message.author.id);

        if (!isRegistered) {
            await channelService.replySafe(message, "Tu n'apparais pas dans les utilisateurs enregistrés, un petit coup de !jeVeuxJouerStpCreeMoiUnComptePourquoiCetteCommandeEstSiLongueJeHaisLesDevs semble s'imposer");
            return;
        }
        
        // Route vers les commandes spécifiques
        try {
            // !game : accepte un type de jeu en argument ("!game type") ou rien
            if (message.content === '!game' || message.content.startsWith('!game ')) {
                await commands.game.execute(message);
                return;
            }
            // !capture : accepte un type de ball en argument ("!capture pokeball") ou rien
            if (message.content === '!capture' || message.content.startsWith('!capture ')) {
                await commands.capture.execute(message, pendingResponses);
                return;
            }
            // !shop : accepte un type de ball en argument ("!shop pokeball5") ou rien
            if (message.content === '!shop' || message.content.startsWith('!shop ')) {
                await commands.shop.execute(message, pendingResponses);
                return;
            }
            switch (message.content) {
                case '!work':
                    await commands.work.execute(message);
                    break;
                case '!money':
                    await commands.money.execute(message);
                    break;
                case '!balls':
                    await commands.balls.execute(message);
                    break;
                case '!pokedex':
                    await commands.pokedex.execute(message);
                    break;
                case '!casino':
                    await commands.casino.execute(message, pendingResponses);
                    break;
                default:
                    // Commande inconnue
                    await channelService.replySafe(
                        message,
                        "Commande inconnue. Le problème semble se situer entre la chaise et le clavier, à bon entendeur..."
                    );
                    break;
            }
        } catch (error) {
            console.error('❌ Erreur lors de l\'exécution de la commande:', error);
            await channelService.replySafe(message, "Une erreur est survenue lors de l'exécution de la commande.");
        }
    }
}
