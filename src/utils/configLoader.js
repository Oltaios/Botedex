/**
 * Chargeur de configuration
 * Centralise le chargement des fichiers JSON de config
 * Utilisation : import { getConfig } from './utils/configLoader.js';
 */

import 'dotenv/config';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Cache pour éviter de recharger la config
let configCache = null;

/**
 * Charge la configuration depuis /config/gameConfig.json
 * @returns {Object} - Objet de configuration
 */
export function getConfig() {
    if (configCache) return configCache;
    
    try {
        const configPath = join(__dirname, '../../config/gameConfig.json');
        const fileContent = readFileSync(configPath, 'utf-8');
        configCache = JSON.parse(fileContent);
        console.log('✅ Configuration chargée avec succès');
        return configCache;
    } catch (error) {
        console.error('❌ Erreur de chargement de la config:', error);
        // Config par défaut en cas d'erreur
        configCache = {
            balls: {
                pokeball: { nom: 'Pokeball', rate: 1, price: 10, feesMultiplier: 1 },
                superball: { nom: 'Superball', rate: 1.5, price: 15, feesMultiplier: 1 },
                hyperball: { nom: 'Hyperball', rate: 2, price: 20, feesMultiplier: 1 },
                maitreball: { nom: 'MaitreBall', rate: 100, price: 2000, feesMultiplier: 1 }
            },
            economy: { workReward: 100, duplicateCaptureReward: 100, gameCooldownHours: 24 },
            admin: { adminUserIds: '' },
            game: { numberOfPokemon: 251, chooseGameTimeMs: 15000, guessMyTypeTimeMs: 15000, guessMyTypeMaxAttempts: 3, guessMyTypeRewardSingle: 100, guessMyWeightTimeMs: 15000, guessMyWeightMaxAttempts: 3, guessMyWeightTolerance: 0.1, guessMyWeightReward: 100, guessMyNameReward: 50 },
            casino: { minBet: 1, maxBet: 500, responseTimeMs: 15000, payouts: [{ chance: 0.005, multiplier: 50, label: 'Jackpot' }, { chance: 0.03, multiplier: 10, label: 'Gros lot' }, { chance: 0.08, multiplier: 3, label: 'Lot moyen' }, { chance: 0.14, multiplier: 1, label: 'Remboursement' }] },
            spawn: { minIntervalMinutes: 30, maxIntervalMinutes: 60 }
        };
        return configCache;
    }
}

/**
 * Charge la configuration de la base de données
 * Secrets (MONGODB_URI, DATABASE_NAME) : variables d'environnement du .env
 * Le fichier config/database.json ne fournit que les éléments non sensibles
 * (collections, nom de la base par défaut)
 * @returns {Object} - { mongoDbUri, databaseName, collections }
 */
/**
 * Lit le patch note depuis un fichier markdown (release.notesFile, ex: PATCHNOTE.md),
 * avec repli sur release.notes (inline) puis un message par défaut.
 * @param {Object} release - Section "release" de gameConfig.json
 * @param {string} racine - Chemin racine du projet (les chemins relatifs y sont résolus)
 * @returns {string} - Contenu du patch note
 */
export function lirePatchNote(release, racine) {
    const file = release?.notesFile;
    if (file) {
        try {
            const contenu = readFileSync(join(racine, file), 'utf8').trim();
            if (contenu) return contenu;
        } catch (error) {
            console.warn(`[CONFIG] Patch note illisible (${file}), repli sur release.notes :`, error.message);
        }
    }
    if (typeof release?.notes === 'string' && release.notes.trim()) return release.notes.trim();
    return 'Aucune note de version.';
}

let releaseNotesCache = null;

/**
 * Patch note à annoncer au démarrage du bot : lu depuis le fichier markdown
 * release.notesFile (mémoïsé), avec repli sur release.notes.
 * @returns {string}
 */
export function getReleaseNotes() {
    if (releaseNotesCache) return releaseNotesCache;
    releaseNotesCache = lirePatchNote(getConfig().release, join(__dirname, '..', '..'));
    return releaseNotesCache;
}

/**
 * Découpe un texte en morceaux de taille max (limite de caractères d'un message
 * Discord : 2000), en coupant de préférence entre les blocs (ligne vide).
 * @param {string} texte - Texte à découper
 * @param {number} [max=2000] - Taille maximale d'un morceau
 * @returns {Array<string>} - Morceaux à envoyer séparément
 */
export function decouperMessages(texte, max = 2000) {
    const blocs = String(texte).split(/\r?\n\r?\n/).map((b) => b.trim()).filter(Boolean);
    const morceaux = [];
    let courant = '';
    for (const bloc of blocs) {
        const morceau = courant ? courant + '\n\n' + bloc : bloc;
        if (morceau.length <= max) {
            courant = morceau;
        } else {
            if (courant) morceaux.push(courant);
            if (bloc.length <= max) {
                courant = bloc;
            } else {
                // bloc trop long seul : découpage dur
                for (let i = 0; i < bloc.length; i += max) morceaux.push(bloc.slice(i, i + max));
                courant = '';
            }
        }
    }
    if (courant) morceaux.push(courant);
    return morceaux.length ? morceaux : [''];
}

/**
 * Retourne la liste des ID Discord des administrateurs du bot
 * (commande !admin). Source : admin.adminUserIds dans gameConfig.json,
 * chaîne d'IDs séparés par des virgules (ex: "111111,222222").
 * La variable d'environnement ADMIN_USER_IDS, si définie, prime sur le
 * fichier de config (même format) : utile pour les déploiements et les tests.
 * @returns {Array<string>} - ID Discord des administrateurs (tableau vide si aucun)
 */
export function getAdminUserIds() {
    const raw = process.env.ADMIN_USER_IDS || getConfig().admin?.adminUserIds || '';
    return raw
        .split(',')
        .map(id => id.trim())
        .filter(id => id !== '');
}

export function getDatabaseConfig() {
    try {
        const configPath = join(__dirname, '../../config/database.json');
        const fileContent = readFileSync(configPath, 'utf-8');
        const fileConfig = JSON.parse(fileContent);
        return {
            ...fileConfig,
            mongoDbUri: process.env.MONGODB_URI,
            databaseName: process.env.DATABASE_NAME || fileConfig.databaseName
        };
    } catch (error) {
        console.error('❌ Erreur de chargement de la config DB:', error);
        return {
            mongoDbUri: process.env.MONGODB_URI,
            databaseName: process.env.DATABASE_NAME || 'botedex'
        };
    }
}


/**
 * Retourne l'ID du serveur Discord servi par cette instance (DISCORD_GUILD_ID).
 * Utilisé pour les opérations d'instance sans contexte de message (reset
 * quotidien des jetons de jeu, libération du travail au démarrage) : avec la
 * clé composite { guildId, userId }, chaque instance ne réinitialise que les
 * dresseurs de son serveur, même avec une base de données commune.
 * @returns {string|null} - ID du serveur, ou null si non défini
 *          (mono-serveur : les opérations s'appliquent alors à toutes les guilds)
 */
export function getDiscordGuildId() {
    return process.env.DISCORD_GUILD_ID || null;
}
