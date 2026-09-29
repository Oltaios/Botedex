# Botedex

Bot Discord de capture de Pokémon façon Pokédex : des Pokémon apparaissent à intervalles
aléatoires dans le channel du bot, les dresseurs les capturent avec des balls achetées
au shop, complètent leur Pokédex et gagnent de l'argent en jouant ou en travaillant.

## Démarrage rapide

```bash
npm install
cp .env.example .env        # puis remplir les valeurs (token, MongoDB, etc.)
npm start
```

## Arborescence du projet

```
botedex/
├── config/                    Configuration métier
│   ├── gameConfig.json        Prix des balls, récompenses, mini-jeu, intervalles de spawn
│   └── database.json          Nom de la base et des collections (l'URI est dans le .env)
├── data/
│   └── pokemonLight.csv       Données Pokémon (noms, types, taux de capture) — 151 lignes
├── src/
│   ├── commands/              Une commande Discord par fichier + index.js
│   │   ├── index.js           Centralise les exports et les metadata (pour !help)
│   │   ├── shop.js            Achat de balls (collector 15 s, achat atomique en BDD)
│   │   ├── capture.js         Délègue le flux à CaptureService
│   │   ├── game.js            Mini-jeu « devine le type » (jeton quotidien)
│   │   ├── work.js            Partir travailler (paye après 1 h)
│   │   └── ...                money, balls, pokedex, ping, gif, help, startSpawn
│   ├── core/
│   │   ├── index.js           Point d'entrée : version, login Discord, init des services
│   │   └── client.js          Client Discord (singleton) + état global :
│                              spawn actif (_numPkmAvailable), pendingResponses
│   ├── events/
│   │   ├── index.js           Enregistre les événements sur le client
│   │   └── messageCreate.js   Routeur des commandes : n'écoute que le channel
│                              principal, vérifie l'enregistrement du dresseur,
│                              répartit vers commands/
│   ├── models/                Modèles de données purs (aucune dépendance Discord/BDD)
│   │   ├── Ball.js            Une ball avec son prix et son multiplicateur de capture
│   │   └── Pokemon.js         Un Pokémon (numéro, nom, types)
│   ├── services/              Logique métier — c'est ici que vit le jeu
│   │   ├── bdd/BDDService.js  Unique point d'accès à MongoDB : CRUD générique +
│   │   │                      méthodes métier (captures, argent, balls, travail)
│   │   ├── capture/CaptureService.js   Flux de capture : inventaire, choix de la
│   │   │                                ball, tirage, mise à jour du Pokédex
│   │   ├── channel/ChannelService.js   Messagerie centralisée : sendMessage vers le
│   │   │                                channel principal, replySafe pour répondre
│   │   │                                aux commandes
│   │   ├── economy/           MoneyService, InventoryService, WorkService
│   │   └── game/              GameService (jetons quotidiens), SpawnService
│   │                          (apparitions aléatoires + phrases piochées)
│   └── utils/                 Utilitaires sans état
│       ├── configLoader.js    Charge gameConfig.json et la config BDD (.env)
│       ├── parsing.js         Lecture du CSV Pokémon (index des colonnes)
│       ├── phrasesAleatoires.js  Pool de phrases avec substitution {clef}
│       └── gif.js             Stickers Giphy (clé API dans le .env)
├── .env                       Secrets et configuration locale — jamais commité
├── .env.example               Template des variables d'environnement à remplir
└── package.json               Version, scripts npm, dépendances
```

## Flux d'une commande

```
Discord ──► events/messageCreate.js ──► commands/<commande>.js ──► services/... ──► BDDService ──► MongoDB
              (garde channel +           (paramètre la            (logique métier,   (unique accès
               enregistrement)           réponse, appelle          tirages,            à la base)
                                          les services)           atomicité)
```

Quelques règles d'architecture que l'arborescence traduit :

- **`BDDService` est le seul à parler à MongoDB** ; les autres services ne touchent
  jamais le driver directement.
- **`ChannelService` est le seul à envoyer des messages** — soit dans le channel
  principal (`sendMessage`), soit en reply à une commande (`replySafe`).
- **`commands/` gère l'interface** (paramétrage des réponses, collectors Discord),
  **`services/` gère les règles du jeu** — une commande délègue, elle ne calcule pas.
- **Les compteurs en base** (argent, balls, `nbrCapture`, Pokédex) sont mis à jour
  de façon atomique (`$inc`, `$set` ciblés) pour résister aux actions simultanées.

## Variables d'environnement

Voir `.env.example` : token Discord, ID du channel principal, URI MongoDB, nom de la
base, clé API Giphy. Sur un hébergeur (Railway, etc.), les renseigner dans le
tableau du service plutôt que de déployer un fichier `.env`.
