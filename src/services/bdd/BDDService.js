/**
 * Service BDD (Singleton)
 * Responsabilité : unique point d'accès à MongoDB. Gère la connexion et
 * toutes les opérations de persistance (CRUD générique + méthodes métier
 * dédiées aux dresseurs). Aucune autre classe ne parle directement au driver.
 *
 * Schéma du document dresseur (collection 'dresseurs', _id = ID Discord) :
 *   { _id, name, argent, nbrCapture, captureAvailable, gameAvailable,
 *     isWorking, pokeball, superball, hyperball,
 *     '<numéroPokémon>' (1-151): 0|1, ... }
 *
 * Utilisation :
 *   import { bddService } from './services/bdd/BDDService.js';
 *   await bddService.init();
 *   const dresseur = await bddService.readOperation('dresseurs', idDiscord);
 */

import { MongoClient } from 'mongodb';
import { getDatabaseConfig } from '../../utils/configLoader.js';

export class BDDService {
    static #instance = null; // Instance unique (Singleton)
    #client = null;
    #initialized = false;
    #dbConfig = null;

    constructor() {
        if (BDDService.#instance) {
            return BDDService.#instance; // Retourne l'instance existante
        }
        BDDService.#instance = this;
        this.#dbConfig = getDatabaseConfig();
    }

    /**
     * Initialise la connexion à MongoDB
     * À appeler UNE SEULE FOIS au démarrage du bot
     */
    async init() {
        if (this.#initialized) return;
        
        try {
            this.#client = new MongoClient(this.#dbConfig.mongoDbUri);
            await this.#client.connect();
            await this.#client.db("admin").command({ ping: 1 });
            this.#initialized = true;
            console.log("[MONGODB] : Connected successfully to the database");
        } catch (error) {
            console.error("[MONGODB] : Connection error:", error);
            throw error;
        }
    }

    /**
     * Retourne la base de données 'botedex'
     */
    get db() {
        if (!this.#client) {
            throw new Error("BDDService not initialized. Call init() first.");
        }
        return this.#client.db(this.#dbConfig.databaseName);
    }

    /**
     * Ferme la connexion à MongoDB
     */
    async close() {
        if (this.#client) {
            await this.#client.close();
            this.#initialized = false;
        }
    }

    // ========== CRUD OPERATIONS ==========

    /**
     * Crée un nouveau document
     * @param {string} collection - Nom de la collection
     * @param {Object} row - Document à insérer
     * @returns {Promise<ObjectId>} - Identifiant du document inséré
     */
    async createOperation(collection, row) {
        const result = await this.db.collection(collection).insertOne(row);
        return result.insertedId;
    }

    /**
     * Lit un document par son _id
     * @param {string} collection - Nom de la collection
     * @param {string} id - Valeur du champ _id (ID Discord pour les dresseurs)
     * @returns {Promise<Object|null>} - Document trouvé, ou null si inexistant
     */
    async readOperation(collection, id) {
        return await this.db.collection(collection).findOne({ _id: id });
    }

    /**
     * Met à jour un document ($set)
     * Attention : tout ce qui est passé dans update est écrasé. Pour les
     * compteurs soumis à écritures concurrentes (argent, balls, isWorking),
     * préférer les méthodes atomiques dédiées (gainMoney, purchaseBalls, etc.)
     * @param {string} collection - Nom de la collection
     * @param {Object} filter - Filtre de recherche (ex: { _id: id })
     * @param {Object} update - Données à mettre à jour
     * @returns {Promise<number>} - Nombre de documents modifiés
     */
    async updateOperation(collection, filter, update) {
        const result = await this.db.collection(collection).updateOne(filter, { $set: update });
        return result.modifiedCount;
    }

    /**
     * Supprime un document
     * @param {string} collection - Nom de la collection
     * @param {Object} filter - Filtre de recherche
     * @returns {Promise<number>} - Nombre de documents supprimés
     */
    async deleteOperation(collection, filter) {
        const result = await this.db.collection(collection).deleteOne(filter);
        return result.deletedCount;
    }

    // ========== MÉTHODES SPÉCIFIQUES À TON BOT ==========

    /**
     * Vérifie si un Pokémon est déjà capturé par un dresseur
     * @param {string} userId - ID Discord du dresseur
     * @param {number} numPkm - Numéro du Pokémon (clé du champ dans le document)
     * @returns {Promise<boolean>}
     */
    async alreadyCaptured(userId, numPkm) {
        const row = await this.readOperation('dresseurs', userId);
        return row && row[numPkm] === 1;
    }

    /**
     * Enregistre une nouvelle capture : marque le Pokémon comme capturé et
     * incrémente le compteur de captures, en une seule opération atomique
     * @param {string} userId - ID Discord du dresseur
     * @param {number} numPkm - Numéro du Pokémon capturé
     * @returns {Promise<void>}
     */
    async registerNewCapture(userId, numPkm) {
        await this.db.collection('dresseurs').updateOne(
            { _id: userId },
            { $set: { [numPkm]: 1 }, $inc: { nbrCapture: 1 } }
        );
    }

    /**
     * Incrémente le compteur de captures d'un dresseur, sans toucher au
     * Pokédex (utilisé pour les doublons capturés puis revendus)
     * @param {string} userId - ID Discord du dresseur
     * @returns {Promise<void>} - Sans effet si le dresseur n'existe pas
     */
    async incrementCaptureCount(userId) {
        await this.db.collection('dresseurs').updateOne(
            { _id: userId },
            { $inc: { nbrCapture: 1 } }
        );
    }

    /**
     * Vérifie si un utilisateur existe et est enregistré
     * @param {string} userId - ID Discord de l'utilisateur
     * @returns {Promise<boolean>}
     */
    async validerRegleGestionUtilisateurEnregistre(userId) {
        const row = await this.readOperation('dresseurs', userId);
        return row !== null;
    }

    /**
     * Vérifie si un champ booléen (0/1) est actif pour un dresseur
     * @param {string} userId - ID Discord du dresseur
     * @param {string} fieldToCheck - Champ à vérifier (ex: 'gameAvailable')
     * @returns {Promise<boolean>} - true si le champ vaut 1, false sinon
     */
    async checkIfAvailable(userId, fieldToCheck) {
        const row = await this.readOperation('dresseurs', userId);
        return row && row[fieldToCheck] === 1;
    }

    /**
     * Met à jour un champ pour tous les dresseurs ayant ce champ à 0
     * @param {string} fieldToUpdate - Champ à mettre à jour
     * @param {number} value - Nouvelle valeur
     * @returns {Promise<void>}
     */
    async updateMany(fieldToUpdate, value) {
        const filter = { [fieldToUpdate]: 0 };
        const update = { $set: { [fieldToUpdate]: value } };
        await this.db.collection('dresseurs').updateMany(filter, update);
    }

    /**
     * Met à jour un champ pour un dresseur spécifique
     * @param {string} userId - ID Discord du dresseur
     * @param {string} fieldToUpdate - Champ à mettre à jour
     * @param {number} value - Nouvelle valeur
     * @returns {Promise<void>}
     */
    async updateOneFieldForOneUser(userId, fieldToUpdate, value) {
        const filter = { _id: userId };
        const update = { $set: { [fieldToUpdate]: value } };
        await this.db.collection('dresseurs').updateOne(filter, update);
    }

    /**
     * Ajoute de l'argent à un dresseur (incrément atomique)
     * @param {string} userId - ID Discord du dresseur
     * @param {number} amount - Montant à ajouter
     * @returns {Promise<void>} - Sans effet si le dresseur n'existe pas
     */
    async gainMoney(userId, amount) {
        await this.db.collection('dresseurs').updateOne(
            { _id: userId },
            { $inc: { argent: amount } }
        );
    }

    /**
     * Retire une ball à un dresseur (décrément atomique)
     * La condition de stock est dans le filtre : impossible de décompter
     * deux balls en même temps alors qu'il n'en reste qu'une
     * @param {string} userId - ID Discord du dresseur
     * @param {string} ballType - Type de ball ('pokeball', 'superball', 'hyperball')
     * @returns {Promise<number>} - 0 si succès, 1 si stock insuffisant
     */
    async tryToLoseBall(userId, ballType) {
        const result = await this.db.collection('dresseurs').updateOne(
            { _id: userId, [ballType]: { $gt: 0 } },
            { $inc: { [ballType]: -1 } }
        );
        if (result.matchedCount === 0) {
            console.log(`[BDD] tryToLoseBall : ${userId} n'a pas de ${ballType} en stock`);
            return 1; // Stock insuffisant
        }
        return 0; // Succès
    }

    /**
     * Achat de balls atomique : débite le prix et crédite les balls
     * en une seule opération indivisible
     * @param {string} userId - ID Discord du dresseur
     * @param {string} ballType - Type de ball ('pokeball', 'superball', 'hyperball')
     * @param {number} quantity - Nombre de balls achetées (>= 1)
     * @param {number} totalPrice - Prix total à débiter
     * @returns {Promise<number>} - 0 si achat effectué, 1 si solde insuffisant
     */
    async purchaseBalls(userId, ballType, quantity, totalPrice) {
        const result = await this.db.collection('dresseurs').updateOne(
            { _id: userId, argent: { $gte: totalPrice } },
            { $inc: { argent: -totalPrice, [ballType]: quantity } }
        );
        return result.matchedCount === 0 ? 1 : 0;
    }

    /**
     * Crée un nouveau dresseur avec les valeurs par défaut
     * Pré-remplit tous les Pokémon (1 à 151) comme non capturés
     * @param {string} idUser - ID Discord de l'utilisateur (devient le _id)
     * @param {string} username - Nom d'affichage Discord de l'utilisateur
     * @returns {Promise<void>}
     */
    async createNewUser(idUser, username) {
        const row = {
            _id: idUser,
            name: username,
            argent: 0,
            nbrCapture: 0,
            captureAvailable: 1,
            gameAvailable: 1,
            isWorking: 0,
            pokeball: 0,
            superball: 0,
            hyperball: 0
        };
        // Ajoute les champs pour les Pokémon 1-151 (génération 1 du CSV)
        for (let i = 1; i <= 151; i++) {
            row[i] = 0;
        }
        await this.createOperation('dresseurs', row);
    }

    /**
     * Marque un dresseur comme parti travailler (réservation atomique)
     * La condition isWorking = 0 est dans le filtre : deux appels simultanés
     * ne peuvent pas tous deux réserver le dresseur
     * @param {string} userId - ID Discord du dresseur
     * @returns {Promise<number>} - 0 si possible, 1 s'il travaille déjà (ou n'existe pas)
     */
    async userGoToWork(userId) {
        const result = await this.db.collection('dresseurs').updateOne(
            { _id: userId, isWorking: 0 },
            { $set: { isWorking: 1 } }
        );
        return result.matchedCount === 0 ? 1 : 0; // Peut travailler
    }

    /**
     * Retourne l'argent d'un dresseur
     * @param {string} userId - ID Discord du dresseur
     * @returns {Promise<number>} - 0 si le dresseur n'existe pas
     */
    async getMoneyForUser(userId) {
        const row = await this.readOperation('dresseurs', userId);
        return row ? row.argent : 0;
    }

    /**
     * Retourne le stock de balls d'un dresseur
     * @param {string} userId - ID Discord du dresseur
     * @returns {Promise<Array<number>>} - [pokeball, superball, hyperball]
     */
    async getBallsForUser(userId) {
        const row = await this.readOperation('dresseurs', userId);
        return row ? [row.pokeball, row.superball, row.hyperball] : [0, 0, 0];
    }

    /**
     * Retourne le nombre de Pokémon capturés par un dresseur
     * (compte les champs Pokémon 1 à 151 valant 1)
     * @param {string} userId - ID Discord du dresseur
     * @returns {Promise<number>} - 0 si le dresseur n'existe pas
     */
    async getPokedexStateForUser(userId) {
        const row = await this.readOperation('dresseurs', userId);
        if (!row) return 0;
        let count = 0;
        for (let i = 1; i <= 151; i++) {
            if (row[i] === 1) count++;
        }
        return count;
    }

    /**
     * Consomme le jeton de jeu quotidien d'un dresseur
     * @param {string} userId - ID Discord du dresseur
     * @returns {Promise<void>}
     */
    async consumeGameAvailable(userId) {
        await this.updateOneFieldForOneUser(userId, 'gameAvailable', 0);
    }

    /**
     * Réinitialise les jetons de jeu pour tous les dresseurs (mise à 1)
     * Appelé à minuit via GameService.startDailyResetSchedule()
     * @returns {Promise<void>}
     */
    async resetGameAvailable() {
        await this.updateMany('gameAvailable', 1);
        console.log("Reset des tokens game effectué");
    }

    /**
     * Réinitialise le statut de travail de tous les dresseurs (mise à 0)
     * Appelé au démarrage du bot via WorkService.resetAllWork() : les sessions
     * planifiées en mémoire sont perdues au redémarrage, il faut libérer tout le monde
     * @returns {Promise<void>}
     */
    async resetIsWorking() {
        await this.db.collection('dresseurs').updateMany({ isWorking: 1 }, { $set: { isWorking: 0 } });
    }
}

// Exporte une instance unique (Singleton)
export const bddService = new BDDService();
