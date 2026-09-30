/**
 * Commande !shop
 * Affiche le magasin et permet d'acheter des balls
 * 
 * Exemple d'utilisation :
 *   import { execute } from './commands/shop.js';
 *   await execute(message, pendingResponses);
 */

import { Ball } from '../models/Ball.js';
import { bddService } from '../services/bdd/BDDService.js';
import { pendingResponses } from '../core/client.js';
import { channelService } from '../services/channel/ChannelService.js';

/**
 * Exécute la commande !shop
 * Affiche le magasin (types de balls et prix depuis la config), puis attend
 * 15 s une commande d'achat au format "!<typeDeBall><nombre>" (ex: "!pokeball5").
 * Débite l'argent et crédite les balls si le solde suffit.
 * @param {Object} message - Message Discord ayant déclenché la commande
 * @param {Set<string>} pendingResponses - Clés des réponses en attente (pour ignorer les messages du joueur pendant l'attente)
 * @returns {Promise<void>}
 */
export async function execute(message, pendingResponses) {
    const currentUserId = message.author.id;
    const responseKey = `${message.channel.id}:${message.author.id}`;
    
    // Marque l'utilisateur comme "en attente de réponse"
    pendingResponses.add(responseKey);
    
    // Affiche l'inventaire du shop
    const shopInventory = [
        new Ball('pokeball'),
        new Ball('superball'),
        new Ball('hyperball')
    ];

    const moneyAvailable = await bddService.getMoneyForUser(currentUserId);
    
    let messageInventoryShop = "🏪 **Bienvenue au Shop de Netto !**\n\n";
    messageInventoryShop += `💰 Tu as ${moneyAvailable}$\n`
    messageInventoryShop += "📋 **Inventaire disponible :**\n";
    
    shopInventory.forEach(element => {
        messageInventoryShop += `${element.getType()} : ${element.getPrice()}$\n`;
    });

        
    // Inventaire et format regroupés en un seul reply pour ne pinger qu'une fois
    messageInventoryShop += "Format de réponse attendu : `<type de ball><nombre>` (ex: `!pokeball5` pour 5 Pokéballs)";
    await channelService.replySafe(message, messageInventoryShop);
    
    // Crée le collector pour les réponses
    const filter = m => m.author.id === message.author.id && 
                     (m.content.startsWith('!pokeball') || 
                      m.content.startsWith('!superball') || 
                      m.content.startsWith('!hyperball'));
    
    const collector = message.channel.createMessageCollector({ filter, max: 1, time: 15000 });
    
    collector.on('collect', async collected => {
        let nbrBallToBuy = 1;
        let commande = collected.content.substring(1); // Supprime le "!"
        let ballTypeToBuy = null;
        
        if (commande.startsWith('pokeball')) {
            ballTypeToBuy = 'pokeball';
            commande = commande.substring(8);
        } else if (commande.startsWith('superball')) {
            ballTypeToBuy = 'superball';
            commande = commande.substring(9);
        } else if (commande.startsWith('hyperball')) {
            ballTypeToBuy = 'hyperball';
            commande = commande.substring(9);
        }
        
        nbrBallToBuy = parseInt(commande);
        // Quantité invalide ou négative : on retombe sur 1
        // (sécurise aussi le $inc de purchaseBalls contre les quantités négatives)
        if (!Number.isInteger(nbrBallToBuy) || nbrBallToBuy < 1) {
            nbrBallToBuy = 1;
        }
        
        // Trouve le prix de la ball
        const ball = shopInventory.find(el => el.getType() === ballTypeToBuy);
        const price = ball.getPrice();
        const totalPrice = nbrBallToBuy * price;
        
        // Achat atomique : débit et crédit des balls sont indivisibles,
        // le filtre garantit que le solde suffit au moment même de l'opération
        const purchase = await bddService.purchaseBalls(currentUserId, ballTypeToBuy, nbrBallToBuy, totalPrice);
        if (purchase !== 0) {
            // Répond au message d'achat : c'est une réaction directe à ce qu'il vient de taper
            await channelService.replySafe(collected, "💸 T'as pas un kopek minot dégage de là");
        } else {
            const newBalance = await bddService.getMoneyForUser(currentUserId);

            // Résumé de l'opération en sortie de shop
            await collected.reply(
                `🛒 Achat effectué : ${nbrBallToBuy} ${ballTypeToBuy}${nbrBallToBuy > 1 ? 's' : ''} pour ${totalPrice}$\n` +
                `Solde restant : ${newBalance}$\n` +
                `Paré pour aller capturer quelques pokémons !`
            );
        }
    });
    
    collector.on('end', () => {
        if (collector.endReason === 'time') {
            channelService.replySafe(message, "Un grand gaillard t'attrapes par le colbac et te fout dehors, fallait choisir plus vite... (Sortie du shop)");
        }
        pendingResponses.delete(responseKey); // Libère la clé
    });
}

// Metadata pour l'aide automatique
export const metadata = {
    name: 'shop',
    description: 'Affiche le magasin et permet d\'acheter des balls',
    usage: '!shop',
    category: 'Économie'
};
