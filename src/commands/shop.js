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
import { getConfig } from '../utils/configLoader.js';
import { channelService } from '../services/channel/ChannelService.js';

/**
 * Exécute la commande !shop
 * Affiche le magasin (un type de ball par entrée de la config balls, prix
 * inclus), puis attend 15 s une commande d'achat au format
 * "!<typeDeBall><nombre>" (ex: "!pokeball5").
 * Débite l'argent et crédite les balls si le solde suffit.
 * Le type de ball est un mot sans espace : il sert à la fois de mot-clé de
 * commande Discord, de champ de stockage et de libellé.
 * @param {Object} message - Message Discord ayant déclenché la commande
 * @param {Set<string>} pendingResponses - Clés des réponses en attente (pour ignorer les messages du joueur pendant l'attente)
 * @returns {Promise<void>}
 */
export async function execute(message, pendingResponses) {
    const currentUserId = message.author.id;
    const responseKey = `${message.channel.id}:${message.author.id}`;
    
    // Marque l'utilisateur comme "en attente de réponse"
    pendingResponses.add(responseKey);
    
    // Inventaire du shop : un ball par type déclaré dans la config
    const shopInventory = Object.keys(getConfig().balls)
        .map(ballType => new Ball(ballType));

    const moneyAvailable = await bddService.getMoneyForUser(message.guildId, currentUserId);
    
    let messageInventoryShop = "🏪 **Bienvenue au Shop de Netto !**\n\n";
    messageInventoryShop += `💰 Tu as ${moneyAvailable}$\n`
    messageInventoryShop += "📋 **Inventaire disponible :**\n";
    
    shopInventory.forEach(element => {
        messageInventoryShop += `${element.getNom()} : ${element.getPrice()}$\n`;
    });

        
    // Inventaire et format regroupés en un seul reply pour ne pinger qu'une fois
    messageInventoryShop += "Format de réponse attendu : `<type de ball><nombre>` (ex: `!pokeball5` pour 5 Pokéballs)";
    await channelService.replySafe(message, messageInventoryShop);
    
    // Crée le collector pour les réponses : accepte "!<type><nombre>"
    // pour chaque type de ball de la config, sans sensibilité à la casse
    const filter = m => m.author.id === currentUserId &&
        shopInventory.some(element => m.content.toLowerCase().startsWith(`!${element.getType().toLowerCase()}`));
    
    const collector = message.channel.createMessageCollector({ filter, max: 1, time: 15000 });
    
    collector.on('collect', async collected => {
        const commande = collected.content.substring(1).toLowerCase(); // Supprime le "!", insensible à la casse
        
        // Les types sont testés du plus long au plus court : un type ne doit
        // pas être tronqué par un autre type dont il est le préfixe
        const ballTypeToBuy = shopInventory.map(element => element.getType())
            .sort((a, b) => b.length - a.length)
            .find(ballType => commande.startsWith(ballType.toLowerCase()));
        if (ballTypeToBuy === undefined) {
            await channelService.replySafe(collected, "Ce type de ball n'est pas en vente ici.");
            return;
        }
        
        let nbrBallToBuy = parseInt(commande.substring(ballTypeToBuy.length));
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
        const purchase = await bddService.purchaseBalls(message.guildId, currentUserId, ballTypeToBuy, nbrBallToBuy, totalPrice);
        if (purchase !== 0) {
            // Répond au message d'achat : c'est une réaction directe à ce qu'il vient de taper
            await channelService.replySafe(collected, "💸 T'as pas un kopek minot dégage de là");
        } else {
            const newBalance = await bddService.getMoneyForUser(message.guildId, currentUserId);

            // Résumé de l'opération en sortie de shop
            await collected.reply(
                `🛒 Achat effectué : ${nbrBallToBuy} ${ball.getNom()}${nbrBallToBuy > 1 ? 's' : ''} pour ${totalPrice}$\n` +
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
