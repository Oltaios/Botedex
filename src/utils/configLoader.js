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
                pokeball: { rate: 1, price: 10, feesMultiplier: 1 },
                superball: { rate: 1.5, price: 15, feesMultiplier: 1 },
                hyperball: { rate: 2, price: 20, feesMultiplier: 1 }
            },
            economy: { workReward: 100, gameCooldownHours: 24 },
            game: { numberOfPokemon: 151, guessMyTypeTimeMs: 15000, guessMyTypeMaxAttempts: 3, guessMyTypeRewardSingle: 100, guessMyNameReward: 50 },
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
