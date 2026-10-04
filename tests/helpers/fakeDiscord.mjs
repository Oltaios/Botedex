/**
 * Fake maison des objets Discord.js pour les tests.
 * Pas de librairie de mock : un message / channel Discord est ici un simple
 * objet JS enregistrant ce qu'il reçoit (replies / sent).
 *
 * Le fake channel se branche sur le vrai client Discord (non connecté) via :
 *   client.channels.cache.set(channel.id, channel)
 */

/**
 * Crée un faux channel textuel
 * @param {Object} [options]
 * @param {string} [options.id='chan-test'] - ID du channel
 * @param {Function} [options.collectorFactory] - Fabrique de collector
 *        (par défaut un nouveau fakeCollector à chaque appel)
 * @returns {Object} - Channel factice avec l'historique des envois dans .sent
 */
export function fakeChannel({ id = 'chan-test', collectorFactory } = {}) {
    const channel = {
        id,
        sent: [],
        isTextBased: () => true,
        send: async (content) => {
            channel.sent.push(content);
        },
        createMessageCollector: () => (collectorFactory ? collectorFactory() : fakeCollector())
    };
    return channel;
}

/**
 * Crée un faux MessageCollector (choix de ball, réponses de jeu...)
 * Les handlers enregistrés via on() sont déclenchés manuellement par emit(),
 * qui attend la fin des handlers asynchrones.
 */
export function fakeCollector() {
    const handlers = {};
    const collector = {
        endReason: null,
        on: (event, callback) => {
            handlers[event] = callback;
            return collector;
        },
        stop: (reason = 'user') => {
            collector.endReason = reason;
            handlers.end?.();
        },
        resetTimer: () => {},
        emit: (event, arg) => handlers[event]?.(arg)
    };
    return collector;
}

/**
 * Crée un faux message Discord
 * @param {Object} [options]
 * @param {string} [options.id] - ID du message
 * @param {string} [options.authorId='user-1'] - ID de l'auteur
 * @param {string} [options.username='testeur'] - Nom de l'auteur
 * @param {string} [options.guildId='guild-1'] - ID du serveur (clé composite)
 * @param {Object} [options.channel] - Channel factice (créé si absent)
 * @param {string} [options.content=''] - Contenu du message
 * @returns {Object} - Message factice avec l'historique des replies dans .replies
 */
export function fakeMessage({
    id = 'msg-1',
    authorId = 'user-1',
    username = 'testeur',
    guildId = 'guild-1',
    channel,
    content = ''
} = {}) {
    const message = {
        id,
        author: { id: authorId, username },
        guildId,
        channel: channel ?? fakeChannel({ id: 'chan-test' }),
        content,
        replies: [],
        reply: async (replyContent) => {
            message.replies.push(replyContent);
        }
    };
    return message;
}
