/**
 * Commande !shop
 * Affiche le magasin et permet d'acheter des balls
 *
 * Deux usages :
 * - "!shop" : affiche la vitrine, puis attend 15 s une commande d'achat au
 *   format "!<typeDeBall><nombre>" (ex: "!pokeball5")
 * - "!shop <typeDeBall><nombre>" : achat direct sans passer par la vitrine
 *   (même mécanique de raccourci que !capture <ball>, ex: "!shop pokeball5")
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
 * Construit l'inventaire du shop : une ball par type déclaré dans la config
 * @returns {Array<Ball>}
 */
function construireInventaire() {
    return Object.keys(getConfig().balls)
        .map(ballType => new Ball(ballType));
}

/**
 * Résout une commande d'achat "<typeDeBall><nombre>" vers la ball et la
 * quantité à acheter. Les types sont testés du plus long au plus court :
 * un type ne doit pas être tronqué par un autre type dont il est le préfixe.
 * Quantité absente ou invalide : on retombe sur 1
 * (sécurise aussi le $inc de purchaseBalls contre les quantités négatives)
 * @param {string} commande - Saisie en minuscules, sans le "!" initial
 *        (ex: "pokeball5", "superball")
 * @param {Array<Ball>} shopInventory - Inventaire du shop
 * @returns {{ball: Ball, quantity: number}|null} - null si le type est inconnu
 */
function resoudreCommandeAchat(commande, shopInventory) {
    const ball = shopInventory
        .slice()
        .sort((a, b) => b.getType().length - a.getType().length)
        .find(element => commande.startsWith(element.getType().toLowerCase()));
    if (ball === undefined) {
        return null;
    }
    const quantity = parseInt(commande.substring(ball.getType().length));
    if (!Number.isInteger(quantity) || quantity < 1) {
        return { ball, quantity: 1 };
    }
    return { ball, quantity };
}

/**
 * Effectue un achat de balls : achat atomique (débit du prix et crédit des
 * balls indivisibles), puis résumé de l'opération en reply
 * @param {Object} messageCible - Message auquel répondre (commande !shop en
 *        mode raccourci, message d'achat en mode vitrine)
 * @param {string} guildId - ID du serveur Discord (isolation des données)
 * @param {string} userId - ID Discord du dresseur
 * @param {Ball} ball - Ball à acheter
 * @param {number} quantity - Nombre de balls à acheter (>= 1)
 * @returns {Promise<void>}
 */
async function effectuerAchat(messageCible, guildId, userId, ball, quantity) {
    const totalPrice = quantity * ball.getPrice();

    // Achat atomique : débit et crédit des balls sont indivisibles
    const purchase = await bddService.purchaseBalls(guildId, userId, ball.getType(), quantity, totalPrice);
    if (purchase !== 0) {
        // Répond au message d'achat : c'est une réaction directe à ce qu'il vient de taper
        await channelService.replySafe(messageCible, "💸 T'as pas un kopek minot dégage de là");
        return;
    }

    const newBalance = await bddService.getMoneyForUser(guildId, userId);

    // Résumé de l'opération en sortie de shop
    await channelService.replySafe(messageCible,
        `🛒 Achat effectué : ${quantity} ${ball.getNom()}${quantity > 1 ? 's' : ''} pour ${totalPrice}$\n` +
        `Solde restant : ${newBalance}$\n` +
        `Paré pour aller capturer quelques pokémons !`
    );
}

/**
 * Exécute la commande !shop
 * Deux usages :
 * - "!shop <ball><nombre>" (raccourci) : achat direct sans question
 * - "!shop" (vitrine) : affiche le magasin (un type de ball par entrée de la
 *   config balls, prix inclus), puis attend 15 s une commande d'achat au
 *   format "!<typeDeBall><nombre>" (ex: "!pokeball5").
 * Débite l'argent et crédite les balls si le solde suffit.
 * @param {Object} message - Message Discord ayant déclenché la commande
 * @param {Set<string>} pendingResponses - Clés des réponses en attente (pour ignorer les messages du joueur pendant l'attente)
 * @returns {Promise<void>}
 */
export async function execute(message, pendingResponses) {
    const currentUserId = message.author.id;

    // Mode raccourci "!shop <ball><nombre>" : achat direct sans passer par
    // la vitrine. Insensible à la casse, "!" initial de la ball toléré
    // (ex: "!shop POKEBALL5" ou "!shop !pokeball5")
    const raccourci = message.content.slice('!shop'.length).trim().replace(/^!/, '').toLowerCase();
    if (raccourci !== '') {
        const shopInventory = construireInventaire();
        const achat = resoudreCommandeAchat(raccourci, shopInventory);
        if (achat === null) {
            const ballsEnVente = shopInventory.map(element => element.getNom()).join(', ');
            await channelService.replySafe(message, `Ce type de ball n'est pas en vente ici. Balls en vente : ${ballsEnVente}`);
            return;
        }
        await effectuerAchat(message, message.guildId, currentUserId, achat.ball, achat.quantity);
        return;
    }

    const responseKey = `${message.channel.id}:${message.author.id}`;

    // Marque l'utilisateur comme "en attente de réponse"
    pendingResponses.add(responseKey);

    // Inventaire du shop : un ball par type déclaré dans la config
    const shopInventory = construireInventaire();

    const moneyAvailable = await bddService.getMoneyForUser(message.guildId, currentUserId);

    let messageInventoryShop = "🏪 **Bienvenue au Shop de Netto !**\n\n";
    messageInventoryShop += `💰 Tu as ${moneyAvailable}$\n`
    messageInventoryShop += "📋 **Inventaire disponible :**\n";

    shopInventory.forEach(element => {
        messageInventoryShop += `${element.getNom()} : ${element.getPrice()}$\n`;
    });


    // Inventaire et format regroupés en un seul reply pour ne pinger qu'une fois
    messageInventoryShop += "Format de réponse attendu : `<type de ball><nombre>` (ex: `!pokeball5` pour 5 Pokéballs)\n";
    messageInventoryShop += "Ou en raccourci direct (pour une prochaine commande) : `!shop <type de ball><nombre>` (ex: `!shop pokeball5`)";
    await channelService.replySafe(message, messageInventoryShop);

    // Crée le collector pour les réponses : accepte "!<type><nombre>"
    // pour chaque type de ball de la config, sans sensibilité à la casse
    const filter = m => m.author.id === currentUserId &&
        shopInventory.some(element => m.content.toLowerCase().startsWith(`!${element.getType().toLowerCase()}`));

    const collector = message.channel.createMessageCollector({ filter, max: 1, time: 15000 });

    collector.on('collect', async collected => {
        const commande = collected.content.substring(1).toLowerCase(); // Supprime le "!", insensible à la casse
        const achat = resoudreCommandeAchat(commande, shopInventory);
        if (achat === null) {
            await channelService.replySafe(collected, "Ce type de ball n'est pas en vente ici.");
            return;
        }
        await effectuerAchat(collected, message.guildId, currentUserId, achat.ball, achat.quantity);
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
    description: 'Affiche le magasin et permet d\'acheter des balls (raccourci : !shop <ball><nombre>)',
    usage: '!shop [<type de ball><nombre>]',
    category: 'Économie'
};
