/**
 * Environnement de test — à importer EN PREMIER dans chaque fichier de test.
 *
 * Les imports statiques sont évalués dans l'ordre d'apparition : ce module
 * s'exécute donc avant tout code applicatif. Il définit les variables que le
 * code lit au moment de son chargement :
 * - DISCORD_TOKEN : core/client.js fait process.exit(1) s'il est absent
 * - GIPHY_API_KEY : utils/gif.js le fige au moment de son import
 * - DATABASE_NAME : nom de la base utilisée par les tests (Mongo mémoire)
 *
 * dotenv (chargé par le code applicatif) n'écrase pas une variable déjà
 * définie : ces valeurs priment donc sur le .env local.
 */
process.env.DISCORD_TOKEN ??= 'token-de-test';
process.env.GIPHY_API_KEY ??= 'cle-giphy-de-test';
process.env.DATABASE_NAME ??= 'botedex-test';
