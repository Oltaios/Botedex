/**
 * Service BDD (Singleton)
 * Responsabilité : unique point d'accès à MongoDB. Gère la connexion et
 * toutes les opérations de persistance (CRUD générique + méthodes métier
 * dédiées aux dresseurs). Aucune autre classe ne parle directement au driver.
 *
 * Isolation multi-serveurs : les dresseurs sont isolés par serveur Discord
 * via une clé composite _id = { guildId, userId }. Un même dresseur Discord
 * possède un document distinct sur chaque serveur, tous dans la même
 * collection. La clé est TOUJOURS construite par #dresseurId() : une
 * recherche par égalité sur un sous-document _id ne matche que si l'ordre
 * des champs est identique.
 *
 * Schéma du document dresseur (collection 'dresseurs') :
 *   { _id: { guildId, userId }, name, argent, nbrCapture, captureAvailable,
 *     gameTokens: { '<jeu>': Date du dernier jeton consommé }, isWorking,
 *     workStartTime, argentGagne, ballsAchetees, capturesEchouees, argentMise,
 *     eggActive, eggCaptures, oeufsEclos (œuf : en cours, captures effectuées
 *     depuis l'obtention, éclosions cumulées),
 *     un champ par type de ball de la config,
 *     '<numéroPokémon>' (1-151): 0|1, ... }
 *
 * Utilisation :
 *   import { bddService } from './services/bdd/BDDService.js';
 *   await bddService.init();
 *   const dresseur = await bddService.getDresseur(guildId, idDiscord);
 */

import { MongoClient } from 'mongodb';
import { getConfig, getDatabaseConfig } from '../../utils/configLoader.js';

export class BDDService {
    static #instance = null; // Instance unique (Singleton)
    #client = null;
    #initialized = false;
    #dbConfig = null;
    #dresseursCollection = 'dresseurs'; // Nom résolu depuis database.json

    constructor() {
        if (BDDService.#instance) {
            return BDDService.#instance; // Retourne l'instance existante
        }
        BDDService.#instance = this;
        this.#dbConfig = getDatabaseConfig();
        this.#dresseursCollection = this.#dbConfig.collections?.dresseurs || 'dresseurs';
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
     * @param {string|Object} id - Valeur du champ _id (clé composite
     *        { guildId, userId } pour les dresseurs, cf. #dresseurId)
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

    // ========== DRESSEURS (CLÉ COMPOSITE { guildId, userId }) ==========

    /**
     * Construit la clé composite d'un dresseur
     * Toujours passer par ce helper : une recherche par égalité sur un
     * sous-document _id ne matche que si l'ordre des champs est identique
     * @param {string} guildId - ID du serveur Discord
     * @param {string} userId - ID Discord du dresseur
     * @returns {{guildId: string, userId: string}} - Clé _id du document dresseur
     */
    #dresseurId(guildId, userId) {
        return { guildId, userId };
    }

    /**
     * Lit le document d'un dresseur par sa clé composite
     * @param {string} guildId - ID du serveur Discord (isolation des données)
     * @param {string} userId - ID Discord du dresseur
     * @returns {Promise<Object|null>} - Document trouvé, ou null si inexistant
     */
    async getDresseur(guildId, userId) {
        return await this.readOperation(this.#dresseursCollection, this.#dresseurId(guildId, userId));
    }

    /**
     * Vérifie si un Pokémon est déjà capturé par un dresseur
     * @param {string} guildId - ID du serveur Discord (isolation des données)
     * @param {string} userId - ID Discord du dresseur
     * @param {number} numPkm - Numéro du Pokémon (clé du champ dans le document)
     * @returns {Promise<boolean>}
     */
    async alreadyCaptured(guildId, userId, numPkm) {
        const row = await this.getDresseur(guildId, userId);
        return row && row[numPkm] === 1;
    }

    /**
     * Enregistre une nouvelle capture : marque le Pokémon comme capturé et
     * incrémente le compteur de captures, en une seule opération atomique
     * @param {string} guildId - ID du serveur Discord (isolation des données)
     * @param {string} userId - ID Discord du dresseur
     * @param {number} numPkm - Numéro du Pokémon capturé
     * @returns {Promise<void>}
     */
    async registerNewCapture(guildId, userId, numPkm) {
        await this.db.collection(this.#dresseursCollection).updateOne(
            { _id: this.#dresseurId(guildId, userId) },
            { $set: { [numPkm]: 1 }, $inc: { nbrCapture: 1 } }
        );
    }

    /**
     * Incrémente le compteur de captures d'un dresseur, sans toucher au
     * Pokédex (utilisé pour les doublons capturés puis revendus)
     * @param {string} guildId - ID du serveur Discord (isolation des données)
     * @param {string} userId - ID Discord du dresseur
     * @returns {Promise<void>} - Sans effet si le dresseur n'existe pas
     */
    async incrementCaptureCount(guildId, userId) {
        await this.db.collection(this.#dresseursCollection).updateOne(
            { _id: this.#dresseurId(guildId, userId) },
            { $inc: { nbrCapture: 1 } }
        );
    }

    /**
     * Vérifie si un utilisateur existe et est enregistré sur ce serveur
     * @param {string} guildId - ID du serveur Discord (isolation des données)
     * @param {string} userId - ID Discord de l'utilisateur
     * @returns {Promise<boolean>}
     */
    async validerRegleGestionUtilisateurEnregistre(guildId, userId) {
        const row = await this.getDresseur(guildId, userId);
        return row !== null;
    }

    /**
     * Vérifie si un champ booléen (0/1) est actif pour un dresseur
     * @param {string} guildId - ID du serveur Discord (isolation des données)
     * @param {string} userId - ID Discord du dresseur
     * @param {string} fieldToCheck - Champ à vérifier (ex: 'captureAvailable')
     * @returns {Promise<boolean>} - true si le champ vaut 1, false sinon
     */
    async checkIfAvailable(guildId, userId, fieldToCheck) {
        const row = await this.getDresseur(guildId, userId);
        return row ? row[fieldToCheck] === 1 : false;
    }

    /**
     * Met à jour un champ pour tous les dresseurs d'un serveur ayant ce champ à 0
     * @param {string|null} guildId - ID du serveur Discord, ou null pour toutes
     *        les guilds (mono-serveur, sans isolation)
     * @param {string} fieldToUpdate - Champ à mettre à jour
     * @param {number} value - Nouvelle valeur
     * @returns {Promise<void>}
     */
    async updateMany(guildId, fieldToUpdate, value) {
        const filter = guildId
            ? { '_id.guildId': guildId, [fieldToUpdate]: 0 }
            : { [fieldToUpdate]: 0 };
        const update = { $set: { [fieldToUpdate]: value } };
        await this.db.collection(this.#dresseursCollection).updateMany(filter, update);
    }

    /**
     * Met à jour un champ pour un dresseur spécifique
     * @param {string} guildId - ID du serveur Discord (isolation des données)
     * @param {string} userId - ID Discord du dresseur
     * @param {string} fieldToUpdate - Champ à mettre à jour
     * @param {number} value - Nouvelle valeur
     * @returns {Promise<void>}
     */
    async updateOneFieldForOneUser(guildId, userId, fieldToUpdate, value) {
        const filter = { _id: this.#dresseurId(guildId, userId) };
        const update = { $set: { [fieldToUpdate]: value } };
        await this.db.collection(this.#dresseursCollection).updateOne(filter, update);
    }

    /**
     * Ajoute de l'argent à un dresseur (incrément atomique)
     * Alimente aussi le compteur de statistique argentGagne (total accumulé)
     * @param {string} guildId - ID du serveur Discord (isolation des données)
     * @param {string} userId - ID Discord du dresseur
     * @param {number} amount - Montant à ajouter
     * @returns {Promise<void>} - Sans effet si le dresseur n'existe pas
     */
    async gainMoney(guildId, userId, amount) {
        await this.db.collection(this.#dresseursCollection).updateOne(
            { _id: this.#dresseurId(guildId, userId) },
            { $inc: { argent: amount, argentGagne: amount } }
        );
    }

    /**
     * Retire une ball à un dresseur (décrément atomique)
     * La condition de stock est dans le filtre : impossible de décompter
     * deux balls en même temps alors qu'il n'en reste qu'une
     * @param {string} guildId - ID du serveur Discord (isolation des données)
     * @param {string} userId - ID Discord du dresseur
     * @param {string} ballType - Type de ball ('pokeball', 'superball', 'hyperball')
     * @returns {Promise<number>} - 0 si succès, 1 si stock insuffisant
     */
    async tryToLoseBall(guildId, userId, ballType) {
        const result = await this.db.collection(this.#dresseursCollection).updateOne(
            { _id: this.#dresseurId(guildId, userId), [ballType]: { $gt: 0 } },
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
     * (alimente aussi le compteur de statistique ballsAchetees)
     * en une seule opération indivisible
     * @param {string} guildId - ID du serveur Discord (isolation des données)
     * @param {string} userId - ID Discord du dresseur
     * @param {string} ballType - Type de ball ('pokeball', 'superball', 'hyperball')
     * @param {number} quantity - Nombre de balls achetées (>= 1)
     * @param {number} totalPrice - Prix total à débiter
     * @returns {Promise<number>} - 0 si achat effectué, 1 si solde insuffisant
     */
    async purchaseBalls(guildId, userId, ballType, quantity, totalPrice) {
        const result = await this.db.collection(this.#dresseursCollection).updateOne(
            { _id: this.#dresseurId(guildId, userId), argent: { $gte: totalPrice } },
            { $inc: { argent: -totalPrice, [ballType]: quantity, ballsAchetees: quantity } }
        );
        return result.matchedCount === 0 ? 1 : 0;
    }

    /**
     * Règle un pari de casino de façon atomique : applique la variation nette
     * (gain - mise) en une seule opération indivisible. Alimente aussi les
     * compteurs de statistiques : argentMise (total misé) et argentGagne
     * (partie gain brut du tirage, 0 si perte sèche). La condition de solde
     * est dans le filtre : impossible de passer sous 0 même si le solde a
     * changé depuis la vérification en amont
     * @param {string} guildId - ID du serveur Discord (isolation des données)
     * @param {string} userId - ID Discord du dresseur
     * @param {number} bet - Mise engagée (>= 0)
     * @param {number} netChange - Variation nette du solde (>= -bet)
     * @returns {Promise<number>} - 0 si pari réglé, 1 si solde insuffisant
     */
    async settleCasinoBet(guildId, userId, bet, netChange) {
        const result = await this.db.collection(this.#dresseursCollection).updateOne(
            { _id: this.#dresseurId(guildId, userId), argent: { $gte: bet } },
            { $inc: { argent: netChange, argentMise: bet, argentGagne: Math.max(0, netChange + bet) } }
        );
        return result.matchedCount === 0 ? 1 : 0;
    }

    /**
     * Crée un nouveau dresseur avec les valeurs par défaut
     * Pré-remplit tous les Pokémon (1 à 151) comme non capturés
     * @param {string} guildId - ID du serveur Discord (isolation des données)
     * @param {string} idUser - ID Discord de l'utilisateur (partie userId de la clé _id)
     * @param {string} username - Nom d'affichage Discord de l'utilisateur
     * @returns {Promise<void>}
     */
    async createNewUser(guildId, idUser, username) {
        const row = {
            _id: this.#dresseurId(guildId, idUser),
            name: username,
            argent: 500,
            nbrCapture: 0,
            captureAvailable: 1,
            isWorking: 0,
            workStartTime: null,
            // Compteurs de statistiques (suivi de l'activité du dresseur)
            argentGagne: 0,
            ballsAchetees: 0,
            capturesEchouees: 0,
            argentMise: 0,
            // Œuf : en cours (0 = aucun), captures effectuées depuis son obtention
            // et éclosions cumulées (statistique de classement)
            eggActive: 0,
            eggCaptures: 0,
            oeufsEclos: 0
        };
        // Ajoute un champ de stock par type de ball de la config (0 par défaut)
        for (const ballType of Object.keys(getConfig().balls)) {
            row[ballType] = 0;
        }
        // Ajoute les champs pour les Pokémon 1-151 (génération 1 du CSV)
        for (let i = 1; i <= 151; i++) {
            row[i] = 0;
        }
        await this.createOperation(this.#dresseursCollection, row);
    }

    /**
     * Marque un dresseur comme parti travailler (réservation atomique)
     * La condition isWorking = 0 est dans le filtre : deux appels simultanés
     * ne peuvent pas tous deux réserver le dresseur
     * Enregistre l'heure de début de session (workStartTime) pour
     * permettre le calcul du temps restant
     * @param {string} guildId - ID du serveur Discord (isolation des données)
     * @param {string} userId - ID Discord du dresseur
     * @returns {Promise<number>} - 0 si possible, 1 s'il travaille déjà (ou n'existe pas)
     */
    async userGoToWork(guildId, userId) {
        const result = await this.db.collection(this.#dresseursCollection).updateOne(
            { _id: this.#dresseurId(guildId, userId), isWorking: 0 },
            { $set: { isWorking: 1, workStartTime: Date.now() } }
        );
        return result.matchedCount === 0 ? 1 : 0; // Peut travailler
    }

    /**
     * Retourne l'heure de début de session de travail d'un dresseur
     * Projection sur le seul champ workStartTime : évite de charger
     * tout le document (151 champs Pokédex) pour une simple lecture
     * @param {string} guildId - ID du serveur Discord (isolation des données)
     * @param {string} userId - ID Discord du dresseur
     * @returns {Promise<number|null>} - Timestamp de début en ms, ou null
     *          si le dresseur n'existe pas / n'a jamais travaillé
     */
    async getStartWorkTimeUser(guildId, userId) {
        const row = await this.db.collection(this.#dresseursCollection).findOne(
            { _id: this.#dresseurId(guildId, userId) },
            { projection: { _id: 0, workStartTime: 1 } }
        );
        // ?? null normalise undefined (champ absent) en null : le contrat
        // de la methode est "null si pas de session", quel que soit le stockage
        return row?.workStartTime ?? null;
    }

    /**
     * Retourne tous les dresseurs actuellement au travail (isWorking = 1)
     * Projection sur les seuls champs utiles : évite de charger tout le
     * document (151 champs Pokédex) pour chaque dresseur
     * @param {string|null} guildId - ID du serveur Discord, ou null pour toutes
     *        les guilds (mono-serveur, sans isolation)
     * @returns {Promise<Array<Object>>} - Dresseurs au travail :
     *          [{ _id: { guildId, userId }, name, workStartTime }]
     */
    async getWorkingDresseurs(guildId) {
        const filter = guildId
            ? { '_id.guildId': guildId, isWorking: 1 }
            : { isWorking: 1 };
        return await this.db.collection(this.#dresseursCollection)
            .find(filter, { projection: { _id: 1, name: 1, workStartTime: 1 } })
            .toArray();
    }

    /**
     * Retourne l'argent d'un dresseur
     * @param {string} guildId - ID du serveur Discord (isolation des données)
     * @param {string} userId - ID Discord du dresseur
     * @returns {Promise<number>} - 0 si le dresseur n'existe pas
     */
    async getMoneyForUser(guildId, userId) {
        const row = await this.getDresseur(guildId, userId);
        return row ? row.argent : 0;
    }

    /**
     * Retourne le stock de balls d'un dresseur
     * @param {string} guildId - ID du serveur Discord (isolation des données)
     * @param {string} userId - ID Discord du dresseur
     * @returns {Promise<Array<number>>} - Un stock par type de ball de la config (ordre de la config)
     */
    async getBallsForUser(guildId, userId) {
        const row = await this.getDresseur(guildId, userId);
        // Un stock par type de ball de la config, dans l'ordre de la config
        return Object.keys(getConfig().balls).map(ballType => row?.[ballType] || 0);
    }

    /**
     * Retourne le nombre de Pokémon capturés par un dresseur
     * (compte les champs Pokémon 1 à 151 valant 1)
     * @param {string} guildId - ID du serveur Discord (isolation des données)
     * @param {string} userId - ID Discord du dresseur
     * @returns {Promise<number>} - 0 si le dresseur n'existe pas
     */
    async getPokedexStateForUser(guildId, userId) {
        const row = await this.getDresseur(guildId, userId);
        if (!row) return 0;
        let count = 0;
        for (let i = 1; i <= 151; i++) {
            if (row[i] === 1) count++;
        }
        return count;
    }

    /**
     * Retourne la date du dernier jeton de jeu consommé pour un jeu donné
     * Un jeton est consommé à la première réponse d'un mini-jeu ; sa
     * disponibilité se calcule par comparaison avec l'heure courante
     * (GameService.isGameAvailable), sans reset planifié
     * Projection sur le seul champ utile : évite de charger tout le
     * document (151 champs Pokédex)
     * @param {string} guildId - ID du serveur Discord (isolation des données)
     * @param {string} userId - ID Discord du dresseur
     * @param {string} gameType - Type de jeu (clé dans gameTokens, ex: 'type')
     * @returns {Promise<Date|null>} - Date du dernier jeton consommé, ou null
     *          si le dresseur n'existe pas / n'a jamais joué à ce jeu
     */
    async getGameLastPlayedAt(guildId, userId, gameType) {
        const row = await this.db.collection(this.#dresseursCollection).findOne(
            { _id: this.#dresseurId(guildId, userId) },
            { projection: { _id: 0, gameTokens: 1 } }
        );
        const lastPlayedAt = row?.gameTokens?.[gameType] ?? null;
        return lastPlayedAt !== null ? new Date(lastPlayedAt) : null;
    }

    /**
     * Consomme le jeton de jeu d'un dresseur pour un jeu donné : enregistre
     * la date de consommation dans la map gameTokens
     * @param {string} guildId - ID du serveur Discord (isolation des données)
     * @param {string} userId - ID Discord du dresseur
     * @param {string} gameType - Type de jeu (clé dans gameTokens, ex: 'type')
     * @param {Date} date - Date de consommation du jeton
     * @returns {Promise<void>}
     */
    async recordGamePlayed(guildId, userId, gameType, date) {
        await this.db.collection(this.#dresseursCollection).updateOne(
            { _id: this.#dresseurId(guildId, userId) },
            { $set: { [`gameTokens.${gameType}`]: date } }
        );
    }

    /**
     * Réinitialise le statut de travail des dresseurs d'un serveur (mise à 0)
     * Appelé au démarrage du bot via WorkService.resetAllWork() : les sessions
     * planifiées en mémoire sont perdues au redémarrage, il faut libérer tout le monde.
     * Le filtre par serveur est indispensable en multi-instances : sans lui, un
     * redémarrage libérerait aussi les dresseurs suivis par les autres instances.
     * @param {string|null} guildId - ID du serveur Discord, ou null pour toutes
     *        les guilds (mono-serveur, sans isolation)
     * @returns {Promise<void>}
     */
    async resetIsWorking(guildId) {
        const filter = guildId
            ? { '_id.guildId': guildId, isWorking: 1 }
            : { isWorking: 1 };
        await this.db.collection(this.#dresseursCollection).updateMany(filter, { $set: { isWorking: 0 } });
    }

    /**
     * Enregistre un échec de capture pour un dresseur (compteur de statistique)
     * @param {string} guildId - ID du serveur Discord (isolation des données)
     * @param {string} userId - ID Discord du dresseur
     * @returns {Promise<void>} - Sans effet si le dresseur n'existe pas
     */
    async incrementerEchecCapture(guildId, userId) {
        await this.db.collection(this.#dresseursCollection).updateOne(
            { _id: this.#dresseurId(guildId, userId) },
            { $inc: { capturesEchouees: 1 } }
        );
    }

    /**
     * Retourne les statistiques agrégées des dresseurs d'un serveur :
     * nombre de dresseurs, argent total accumulé (gains bruts), balls
     * achetées, échecs de capture, argent misé au casino et argent
     * actuellement en circulation (somme des soldes)
     * @param {string|null} guildId - ID du serveur Discord, ou null pour toutes
     *        les guilds (mono-serveur, sans isolation)
     * @returns {Promise<Object>} - { dresseurs, argentGagne, ballsAchetees,
     *          capturesEchouees, argentMise, argentEnCirculation }
     */
    async getStatsDresseurs(guildId) {
        const match = guildId ? { '_id.guildId': guildId } : {};
        const [stats] = await this.db.collection(this.#dresseursCollection).aggregate([
            { $match: match },
            { $group: {
                _id: null,
                dresseurs: { $sum: 1 },
                argentGagne: { $sum: '$argentGagne' },
                ballsAchetees: { $sum: '$ballsAchetees' },
                capturesEchouees: { $sum: '$capturesEchouees' },
                argentMise: { $sum: '$argentMise' },
                argentEnCirculation: { $sum: '$argent' }
            } }
        ]).toArray();
        return stats ?? { dresseurs: 0, argentGagne: 0, ballsAchetees: 0, capturesEchouees: 0, argentMise: 0, argentEnCirculation: 0 };
    }

    /**
     * Retourne les meilleurs dresseurs d'un serveur, classés par argent
     * accumulé, avec leurs compteurs de statistiques (projection réduite,
     * sans les 151 champs Pokédex)
     * @param {string|null} guildId - ID du serveur Discord, ou null pour toutes
     *        les guilds (mono-serveur, sans isolation)
     * @param {number} [limit=5] - Nombre maximal de dresseurs retournés
     * @returns {Promise<Array<Object>>} - [{ userId, name, argent,
     *          argentGagne, ballsAchetees, capturesEchouees, argentMise }]
     */
    async getTopDresseurs(guildId, limit = 5) {
        const filter = guildId ? { '_id.guildId': guildId } : {};
        return await this.db.collection(this.#dresseursCollection)
            .find(filter, {
                projection: {
                    _id: 0,
                    userId: '$_id.userId',
                    name: 1,
                    argent: 1,
                    argentGagne: 1,
                    ballsAchetees: 1,
                    capturesEchouees: 1,
                    argentMise: 1
                }
            })
            .sort({ argentGagne: -1 })
            .limit(limit)
            .toArray();
    }
    /**
     * Retourne le classement des dresseurs d'un serveur pour un critère donné :
     * 'pokedex' (nombre de Pokémon distincts capturés), 'captures' (nombre
     * de captures effectuées, doublons inclus, via le compteur nbrCapture)
     * ou 'egg' (nombre d'œufs éclos, via le compteur oeufsEclos).
     * Le critère 'pokedex' est calculé côté serveur en comptant les champs
     * '<numéro>' (1-151) à 1 : les autres champs numériques du document
     * (argent, compteurs) ont des clés non numériques, la regex suffit
     * donc à isoler le Pokédex sans charger les 151 champs côté bot
     * @param {string|null} guildId - ID du serveur Discord, ou null pour toutes
     *        les guilds (mono-serveur, sans isolation)
     * @param {string} [critere='pokedex'] - Critère de tri : 'pokedex', 'captures' ou 'egg'
     * @param {number} [limit=10] - Nombre maximal de dresseurs retournés
     * @returns {Promise<Array<Object>>} - [{ userId, name, score }] trié par
     *          score décroissant puis par nom (égalités déterministes)
     */
    async getClassementDresseurs(guildId, critere = 'pokedex', limit = 10) {
        const filter = guildId ? { '_id.guildId': guildId } : {};
        const score = critere === 'captures'
            ? '$nbrCapture'
            : critere === 'egg'
                // Compteur absent des documents créés avant la feature : 0
                ? { $ifNull: ['$oeufsEclos', 0] }
                : {
                    $size: {
                        $filter: {
                            input: { $objectToArray: '$$ROOT' },
                            as: 'champ',
                            cond: {
                                $and: [
                                    { $eq: ['$$champ.v', 1] },
                                    { $regexMatch: { input: '$$champ.k', regex: '^[0-9]+$' } }
                                ]
                            }
                        }
                    }
                };
        return await this.db.collection(this.#dresseursCollection).aggregate([
            { $match: filter },
            { $addFields: { score } },
            { $sort: { score: -1, name: 1 } },
            { $limit: limit },
            { $project: { _id: 0, userId: '$_id.userId', name: 1, score: 1 } }
        ]).toArray();
    }
    // ========== OEUF (INCUBATION PAR CAPTURES) ==========

    /**
     * Confie un œuf à un dresseur : passe eggActive à 1 et repart de zéro
     * capture. La condition "pas d'œuf en cours" est dans le filtre
     * ($ne et non $eq : les documents créés avant la feature n'ont pas le
     * champ eggActive) : deux appels simultanés ne peuvent pas donner
     * deux œufs, et un œuf en cours ne peut pas être écrasé
     * @param {string} guildId - ID du serveur Discord (isolation des données)
     * @param {string} userId - ID Discord du dresseur
     * @returns {Promise<number>} - 0 si l'œuf est confié, 1 si refus
     *          (œuf déjà en incubation ou dresseur inexistant)
     */
    async giveEgg(guildId, userId) {
        const result = await this.db.collection(this.#dresseursCollection).updateOne(
            { _id: this.#dresseurId(guildId, userId), eggActive: { $ne: 1 } },
            { $set: { eggActive: 1, eggCaptures: 0 } }
        );
        return result.matchedCount === 0 ? 1 : 0;
    }

    /**
     * Retourne l'état de l'œuf d'un dresseur (projection réduite)
     * @param {string} guildId - ID du serveur Discord (isolation des données)
     * @param {string} userId - ID Discord du dresseur
     * @returns {Promise<Object|null>} - { eggActive, eggCaptures }, ou null
     *          si le dresseur n'existe pas
     */
    async getEggState(guildId, userId) {
        return await this.db.collection(this.#dresseursCollection).findOne(
            { _id: this.#dresseurId(guildId, userId) },
            { projection: { _id: 0, eggActive: 1, eggCaptures: 1 } }
        );
    }

    /**
     * Fait progresser l'œuf d'une capture (incrément atomique) et retourne
     * l'état après incrément : la valeur d'eggCaptures lue est celle de ce
     * dresseur, même si deux captures arrivent simultanément
     * @param {string} guildId - ID du serveur Discord (isolation des données)
     * @param {string} userId - ID Discord du dresseur
     * @returns {Promise<Object|null>} - { eggActive, eggCaptures } après
     *          incrément, ou null si aucun œuf n'est en incubation
     */
    async progressEgg(guildId, userId) {
        // Driver v4 : findOneAndUpdate retourne l'enveloppe { value }, pas le
        // document directement (v5+) — on normalise vers doc|null
        const result = await this.db.collection(this.#dresseursCollection).findOneAndUpdate(
            { _id: this.#dresseurId(guildId, userId), eggActive: 1 },
            { $inc: { eggCaptures: 1 } },
            { returnDocument: 'after', projection: { _id: 0, eggActive: 1, eggCaptures: 1 } }
        );
        return result?.value ?? null;
    }

    /**
     * Fait éclore l'œuf : marque le Pokémon numPkm comme capturé dans le
     * Pokédex, réinitialise l'œuf et incrémente le compteur d'œufs éclos
     * (oeufsEclos, statistique de classement), en une seule opération
     * atomique. Les
     * conditions "œuf en cours" et "seuil atteint" sont dans le filtre :
     * l'éclosion est tentée après chaque capture, seul le premier appel
     * au seuil gagne, pas de double Pokémon offert
     * @param {string} guildId - ID du serveur Discord (isolation des données)
     * @param {string} userId - ID Discord du dresseur
     * @param {number} numPkm - Numéro du Pokémon issu de l'œuf (déjà tiré)
     * @param {number} capturesRequises - Seuil d'éclosion (config egg)
     * @returns {Promise<number>} - 0 si l'œuf a éclos, 1 si refus
     *          (pas d'œuf ou seuil non atteint)
     */
    async hatchEgg(guildId, userId, numPkm, capturesRequises) {
        const result = await this.db.collection(this.#dresseursCollection).updateOne(
            {
                _id: this.#dresseurId(guildId, userId),
                eggActive: 1,
                eggCaptures: { $gte: capturesRequises }
            },
            { $set: { eggActive: 0, eggCaptures: 0, [numPkm]: 1 }, $inc: { oeufsEclos: 1 } }
        );
        return result.matchedCount === 0 ? 1 : 0;
    }
}

// Exporte une instance unique (Singleton)
export const bddService = new BDDService();
