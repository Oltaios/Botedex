/**
 * Point d'entrée principal du bot
 * Initialise les services, les commandes et les événements
 * 
 * Exemple d'utilisation :
 *   node src/core/index.js
 */

import { readFile } from 'fs/promises';
import { client, token } from './client.js';
import { bddService } from '../services/bdd/BDDService.js';
import { spawnService } from '../services/game/SpawnService.js';
import { gameService } from '../services/game/GameService.js';
import { workService } from '../services/economy/WorkService.js';
import { channelService } from '../services/channel/ChannelService.js';
import { registerAllEvents } from '../events/index.js';
import { getConfig } from '../utils/configLoader.js';



// ========== INITIALISATION ==========

/**
 * Initialise tous les services du bot dans l'ordre de leurs dépendances :
 * 1. BDDService (connexion MongoDB) - process.exit(1) en cas d'échec
 * 2. ChannelService (channel fixe pour les spawns/annonces)
 * 3. GameService (reset des jetons de jeu + planification quotidienne)
 * 4. WorkService (libération des dresseurs bloqués au travail après un redémarrage)
 * @returns {Promise<void>} - Rejette si la connexion BDD échoue
 */
async function initServices() {
    console.log('🔄 Initialisation des services...');
    
    // Initialise la base de données
    try {
        await bddService.init();
        console.log('✅ BDDService initialisé');
    } catch (error) {
        console.error('❌ Échec de l\'initialisation de BDDService:', error);
        process.exit(1);
    }

    await channelService.init(process.env.DISCORD_CHANNEL_ID);
    let versionBotedex = getLogVersion();
    let patchNote = getConfig().release.notes;
    try {
        await channelService.sendMessage(`Démarrage du Botedex... Je suis up !\n${await versionBotedex}\n\n${patchNote}`);
    } catch (error) {
        console.error('❌ Impossible d\'envoyer le message de démarrage:', error);
    }
    
    // Réinitialise les jetons de jeu
    await gameService.resetAllGameTokens();
    // Planifie le reset quotidien à minuit
    gameService.startDailyResetSchedule();
    console.log('✅ GameService initialisé');

    // Libère les dresseurs bloqués au travail lors d'un redémarrage
    await workService.resetAllWork();

    console.log('✅ Tous les services initialisés avec succès');
}

// ========== ÉVÉNEMENTS DISCORD ==========

/**
 * Événement 'ready' : déclenché quand le client Discord est connecté
 * Initialise les services puis démarre les spawns automatiques
 */
client.once('ready', async () => {
    console.log('✅ Félicitations, votre bot Discord a été correctement initialisé !');
    
    await initServices();

    // TODO: Démarrer les spawns automatiques si nécessaire
    spawnService.startSpawn();
});



// ========== DÉMARRAGE DU BOT ==========

/**
 * Affiche la version du bot, lue depuis package.json (source de vérité)
 * @returns {Promise<void>}
 */
async function getLogVersion() {
    try {
        const packageUrl = new URL('../../package.json', import.meta.url);
        const pkg = JSON.parse(await readFile(packageUrl, 'utf8'));
        return `📦 Botedex v${pkg.version}`;
    } catch (error) {
        console.warn('Version indisponible :', error.message);
        return 'Erreur lors de la lecture de la version';
    }
}

/**
 * Point d'entrée asynchrone du bot
 * Enregistre les événements Discord, connecte le client (process.exit(1)
 * si le login échoue), puis laisse initServices() se déclencher sur 'ready'
 * @returns {Promise<void>}
 */
async function startBot() {
    console.log(`Version du bot : ${await getLogVersion()}`);
    console.log('🚀 Démarrage du bot...');
    
    // 2️⃣ Enregistre TOUS les événements Discord
    registerAllEvents(client); //

    // Connecte le client Discord
    try {
        await client.login(token);
        console.log('✅ Bot connecté à Discord');
    } catch (error) {
        console.error('❌ Échec de la connexion à Discord:', error);
        process.exit(1);
    }

    // Initialise les services
    //await initServices();
        
}

// Démarre le bot
startBot().catch(console.error);

// Gestion des erreurs globales
process.on('unhandledRejection', (error) => {
    console.error('❌ Unhandled Rejection:', error);
});

process.on('uncaughtException', (error) => {
    console.error('❌ Uncaught Exception:', error);
});
