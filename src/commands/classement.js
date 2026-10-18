/**
 * Commande !classement
 * Affiche le classement des dresseurs du serveur selon un critère :
 * "!classement" (ou "!classement pokedex") -> nombre de Pokémon distincts
 * capturés, "!classement captures" -> nombre de captures effectuées
 * (doublons inclus), "!classement egg" -> nombre d'œufs éclos
 *
 * Exemple d'utilisation :
 *   import { execute } from './commands/classement.js';
 *   await execute(message);
 */

import { bddService } from '../services/bdd/BDDService.js';
import { channelService } from '../services/channel/ChannelService.js';

// Taille du classement affiché
const TAILLE_CLASSEMENT = 10;

// Marqueurs du podium, puis numérotation simple au-delà
const MARQUEURS_PODIUM = ['🥇', '🥈', '🥉'];

// Libellés et unités par critère (uniteSingulier optionnel pour l'affichage)
const CRITERES = {
    pokedex: { libelle: 'Pokémon capturés', unite: 'Pokémon' },
    captures: { libelle: 'captures effectuées', unite: 'captures' },
    egg: { libelle: 'œufs éclos', unite: 'œufs éclos', uniteSingulier: 'œuf éclos' }
};

/**
 * Exécute la commande !classement
 * Le critère est le texte éventuel qui suit "!classement"
 * (ex: "!classement captures" -> 'captures') ; s'il est absent, le critère
 * par défaut est 'pokedex'
 * @param {Object} message - Message Discord ayant déclenché la commande
 * @returns {Promise<void>}
 */
export async function execute(message) {
    const critere = message.content.slice('!classement'.length).trim().toLowerCase() || 'pokedex';

    if (!CRITERES[critere]) {
        await channelService.replySafe(
            message,
            "Critère inconnu. Essaie **!classement pokedex** (Pokémon capturés), " +
            "**!classement captures** (captures effectuées) ou **!classement egg** (œufs éclos)."
        );
        return;
    }

    const top = await bddService.getClassementDresseurs(message.guildId, critere, TAILLE_CLASSEMENT);

    if (top.length === 0) {
        await channelService.replySafe(
            message,
            "Aucun dresseur sur ce serveur pour l'instant, le classement est vide."
        );
        return;
    }

    let classement = `🏆 **Classement des dresseurs — ${CRITERES[critere].libelle}**\n`;
    top.forEach((dresseur, index) => {
        const marqueur = MARQUEURS_PODIUM[index] ?? `${index + 1}.`;
        const unite = dresseur.score === 1 && CRITERES[critere].uniteSingulier
            ? CRITERES[critere].uniteSingulier
            : CRITERES[critere].unite;
        classement += `${marqueur} **${dresseur.name}** — ${dresseur.score} ${unite}\n`;
    });
    await channelService.replySafe(message, classement);
}

// Metadata pour l'aide automatique
export const metadata = {
    name: 'classement',
    description: 'Affiche le top des dresseurs du serveur : Pokémon capturés (par défaut), captures effectuées ou œufs éclos',
    usage: '!classement [pokedex|captures|egg]',
    category: 'Pokémon'
};
