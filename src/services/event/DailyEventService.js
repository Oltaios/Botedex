/**
 * Service de l'événement quotidien collaboratif (thème : la Team Rocket a
 * volé des Pokémon, les dresseurs doivent jouer pour les sauver).
 *
 * Principe : jouer (!game), tenter une capture (!capture) et travailler
 * (!work) rapportent des points d'activité au dresseur. Quand le total de
 * points du serveur atteint l'objectif (pointsPerActivePlayer × nombre de
 * joueurs actifs sur les dernières 24h), l'event est terminé : chaque joueur
 * actif reçoit rewardAmount et une annonce congratulative pingue les
 * participants avec le détail des points.
 *
 * Un joueur est actif s'il a lancé une commande dans les dernières 24h
 * (lastCommandAt sur le document dresseur ; isActive est le flag recalculé
 * au reset et à la volée).
 *
 * Reset quotidien à resetHour (2h00 locale) : les points d'activité de tous
 * les dresseurs sont remis à zéro, isActive est recalculé depuis lastCommandAt
 * (fenêtre 24h) et les documents d'event sont réinitialisés. Le reset est
 * planifié par une chaîne de setTimeout (pattern SpawnService) et déclenché
 * paresseusement à la première activité si le bot a tourné après 2h00.
 *
 * Désactivable dans les tests : BOTEDEX_DAILY_EVENT=off.
 *
 * Exemple d'utilisation :
 *   import { dailyEventService } from './services/event/DailyEventService.js';
 *   await dailyEventService.start();
 */

import { getConfig } from '../../utils/configLoader.js';
import { bddService } from '../bdd/BDDService.js';
import { moneyService } from '../economy/MoneyService.js';
import { channelService } from '../channel/ChannelService.js';

const ACTIVE_WINDOW_MS = 24 * 3600 * 1000;

export class DailyEventService {
    constructor() {
        this.config = getConfig();
        this.eventConfig = this.config.dailyEvent ?? {};
        this.resetTimer = null;
    }

    /** Feature flag : config dailyEvent.enabled + env BOTEDEX_DAILY_EVENT */
    get enabled() {
        return this.eventConfig.enabled !== false && process.env.BOTEDEX_DAILY_EVENT !== 'off';
    }

    get points() { return this.eventConfig.points ?? { game: 5, capture: 10, work: 5 }; }
    get pointsPerActivePlayer() { return this.eventConfig.pointsPerActivePlayer ?? 100; }
    get rewardAmount() { return this.eventConfig.rewardAmount ?? 200; }
    get resetHour() { return this.eventConfig.resetHour ?? 2; }

    /**
     * Démarre le service : migration des champs d'activité sur les dresseurs
     * existants, puis planification du reset quotidien
     * @returns {Promise<void>}
     */
    async start() {
        if (!this.enabled) {
            console.log('[EVENT] Événement quotidien désactivé');
            return;
        }
        await bddService.ensureActivityFields();
        this.scheduleReset();
        console.log('[EVENT] Service démarré, reset quotidien à ' + this.resetHour + 'h00 locale');
    }

    /** Arrête le reset planifié (tests) */
    stop() {
        if (this.resetTimer) {
            clearTimeout(this.resetTimer);
            this.resetTimer = null;
        }
    }

    /**
     * Clé de jour locale YYYY-MM-DD (le reset est à heure locale)
     * @param {Date} [now] - Date de référence (injectable pour les tests)
     * @returns {string}
     */
    dateKey(now = new Date()) {
        const p = (n) => String(n).padStart(2, '0');
        return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
    }

    /**
     * Délai en ms jusqu'au prochain reset (resetHour locale, 0 min 0 s)
     * @param {Date} [now] - Date de référence (injectable pour les tests)
     * @returns {number}
     */
    msUntilNextReset(now = new Date()) {
        const next = new Date(now);
        next.setHours(this.resetHour, 0, 0, 0);
        if (next.getTime() <= now.getTime()) {
            next.setDate(next.getDate() + 1);
        }
        return next.getTime() - now.getTime();
    }

    /** Planifie le prochain reset (re-planifié à chaque exécution) */
    scheduleReset() {
        this.stop();
        const delay = this.msUntilNextReset();
        console.log(`[EVENT] Prochain reset dans ${Math.round(delay / 60000)} min`);
        this.resetTimer = setTimeout(async () => {
            await this.performReset().catch(console.error);
            this.scheduleReset();
        }, delay);
    }

    /**
     * Reset quotidien : points d'activité de tous les dresseurs à 0,
     * isActive recalculé (commande dans les dernières 24h), documents
     * d'event réinitialisés avec la dateKey du jour
     * @param {Date} [now] - Date de référence (injectable pour les tests)
     * @returns {Promise<void>}
     */
    async performReset(now = new Date()) {
        await bddService.resetAllActivityPoints();
        await bddService.recomputeActiveFlags(new Date(now.getTime() - ACTIVE_WINDOW_MS));
        await bddService.resetAllDailyEvents(this.dateKey(now));
        console.log(`[EVENT] Reset effectué (${this.dateKey(now)})`);
    }

    /**
     * Marque un dresseur actif (appelé à chaque commande d'un dresseur
     * enregistré) : enregistre lastCommandAt et passe isActive à 1
     * @returns {Promise<void>}
     */
    async touchActivity(guildId, userId) {
        if (!this.enabled) return;
        await bddService.markUserActive(guildId, userId);
    }

    /**
     * Enregistre une activité ('game', 'capture' ou 'work') : ajoute les
     * points au dresseur (et le marque actif), incrémente le total de
     * l'event, recalcule l'objectif (scalable selon les joueurs actifs) et
     * déclenche la complétion si l'objectif est atteint
     * @param {string} guildId - ID du serveur Discord
     * @param {string} userId - ID Discord du dresseur
     * @param {string} kind - 'game' | 'capture' | 'work'
     * @param {Date} [now] - Date de référence (injectable pour les tests)
     * @returns {Promise<void>}
     */
    async registerActivity(guildId, userId, kind, now = new Date()) {
        if (!this.enabled) return;
        const points = this.points[kind] ?? 0;
        if (points <= 0) return;

        const key = this.dateKey(now);
        // Reset paresseux si le bot a tourné après 2h00 sans reset planifié
        const doc = await bddService.getDailyEvent(guildId);
        if (!doc || doc.dateKey !== key) {
            await this.performReset(now);
        }

        await bddService.addActivityPoints(guildId, userId, points);
        await bddService.incDailyEventTotal(guildId, points, key);

        // Objectif scalable : pointsPerActivePlayer × joueurs actifs du serveur
        const activeCount = await bddService.countActivePlayers(guildId);
        const goal = this.pointsPerActivePlayer * Math.max(activeCount, 1);
        await bddService.setDailyEventFields(guildId, { goal });

        const updated = await bddService.getDailyEvent(guildId);
        if (!updated.completed && (updated.totalPoints ?? 0) >= goal) {
            await this.completeEvent(guildId, goal);
        }
    }

    /**
     * Termine l'event du serveur : chaque joueur actif reçoit rewardAmount,
     * puis un message court par joueur (ping) indiquant uniquement ses points,
     * le gain crédité et l'heure du prochain reset
     * @param {string} guildId - ID du serveur Discord
     * @param {number|null} [goal] - Objectif retenu (log)
     * @returns {Promise<void>}
     */
    async completeEvent(guildId, goal = null) {
        const doc = await bddService.getDailyEvent(guildId);
        if (doc?.completed) return; // déjà terminé : idempotent

        const reward = this.rewardAmount;
        await bddService.setDailyEventFields(guildId, { completed: true, rewardPaid: reward, goal: goal ?? doc?.goal ?? 0 });

        const active = await bddService.getActivePlayers(guildId);
        for (const p of active) {
            await moneyService.gainMoney(guildId, p.userId, reward);
            // Message réduit par joueur : ses points, le gain, l'heure du reset
            const annonce =
                `🚀 Événement terminé ! <@${p.userId}> : **${p.activityPoints} pts** → **+${reward}$** crédités. Prochain reset à ${this.resetHour}h00.`;
            try {
                await channelService.sendMessage(annonce);
            } catch (error) {
                console.error('[EVENT] Impossible d\'envoyer le message de fin à ' + p.userId + ':', error);
            }
        }
        console.log(`[EVENT] Event terminé pour ${guildId} : ${active.length} joueur(s) récompensé(s) (${reward}$), total ${doc?.totalPoints ?? 0}/${goal ?? doc?.goal ?? '?'} pts`);
    }

    /**
     * Barre de progression textuelle, ex. [██████░░░░] pour 60%
     * @param {number} ratio - Entre 0 et 1 (borné)
     * @param {number} [taille=10] - Nombre de blocs
     * @returns {string}
     */
    barreProgression(ratio, taille = 10) {
        const r = Math.max(0, Math.min(1, ratio));
        const pleins = Math.round(r * taille);
        return `[${'█'.repeat(pleins)}${'░'.repeat(taille - pleins)}]`;
    }

    /**
     * État de l'event d'un serveur pour la commande !event
     * @param {string} guildId - ID du serveur Discord
     * @param {string} userId - ID Discord du dresseur qui demande
     * @param {Date} [now] - Date de référence (injectable pour les tests)
     * @returns {Promise<Object>} - { dateKey, totalPoints, goal, completed, activeCount, myPoints, isActive, ratio, bar, nextReset }
     */
    async getStatus(guildId, userId, now = new Date()) {
        const key = this.dateKey(now);
        let doc = await bddService.getDailyEvent(guildId);
        if (!doc || doc.dateKey !== key) {
            // Jamais créé ou reset manqué : reset paresseux puis relecture
            await this.performReset(now);
            doc = await bddService.getDailyEvent(guildId);
            if (!doc) {
                await bddService.setDailyEventFields(guildId, { dateKey: key, totalPoints: 0, goal: 0, completed: false, rewardPaid: 0 });
                doc = await bddService.getDailyEvent(guildId);
            }
        }
        const activeCount = await bddService.countActivePlayers(guildId);
        const goal = this.pointsPerActivePlayer * Math.max(activeCount, 1);
        if (doc.goal !== goal) {
            await bddService.setDailyEventFields(guildId, { goal });
        }
        const dresseur = await bddService.getDresseur(guildId, userId);
        const total = doc.totalPoints ?? 0;
        const ratio = goal > 0 ? total / goal : 0;
        return {
            dateKey: key,
            totalPoints: total,
            goal,
            completed: !!doc.completed,
            activeCount,
            myPoints: dresseur?.activityPoints ?? 0,
            isActive: !!dresseur?.isActive,
            ratio,
            bar: this.barreProgression(ratio),
            nextReset: new Date(now.getTime() + this.msUntilNextReset(now))
        };
    }
}

export const dailyEventService = new DailyEventService();
