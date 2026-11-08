# Botedex

Bot Discord de capture de Pokémon façon Pokédex : les 251 Pokémon des générations 1 et 2
apparaissent à intervalles aléatoires dans le channel du bot, les dresseurs les capturent
avec des balls achetées au shop, complètent leur Pokédex et gagnent de l'argent en jouant,
en travaillant ou via l'événement quotidien collaboratif.

## Démarrage rapide

```bash
npm install
cp .env.example .env        # puis remplir les valeurs (token, MongoDB, etc.)
npm start                   # lance le bot
npm test                    # suite de tests (node --test)
```

## Fonctionnalités

- **Spawns aléatoires** : un Pokémon apparaît toutes les 5–12 min ; les **légendaires**
  (`is_legendary = 1` dans le CSV) n'ont que **1 %** de chance de spawn
  (`spawn.pokemonRarity.legendary`).
- **Capture** (`!capture`) : choix de la ball dans l'inventaire (15 s), tirage pondéré par
  le `capture_rate` du Pokémon et le `rate` de la ball. Les **balls typées** (Monsanto Ball,
  Tisanerie Ball, Foret Ball, Dry Ball) passent à **×2** contre leur type, ×1 sinon.
- **Mini-jeux** (`!game type` / `!game poids` / `!game nom` — pendu sur le nom français — / `!game talent` — deviner le talent parmi 4, réponse par réaction emoji 1️⃣-4️⃣) : un jeton **horaire** par jeu et par dresseur.
- **Travail** (`!work`) : paye versée automatiquement après 1 h.
- **Œuf** (`!egg`) : chaque **capture tentée** (réussie ou non) fait progresser l'œuf ;
  après 10 captures il éclot avec un GIF du Pokémon obtenu. 2 chances sur 3 d'obtenir un
  Pokémon que tu ne possèdes pas encore ; sinon tu récupères la récompense de doublon.
- **Événement quotidien collaboratif** (`!event`) : captures (+10 pts), parties (+5 pts) et
  travail (+5 pts) rapportent des points d'activité. Objectif = 100 pts × joueurs actifs
  (commande dans les dernières 24 h). À la complétion, **200 $** pour chaque joueur actif et
  annonce avec pings (thème : la Team Rocket a volé des Pokémon). Reset quotidien à **2 h 00**.
- **Pokédex & LivingDex** (`!pokedex`) : compte de Pokémon capturés et lien livingdex.app en
  dex Johto **251 slots** (`game=gsc`).

## Arborescence du projet

```
botedex/
├── config/                    Configuration métier
│   ├── gameConfig.json        Balls (prix, rates, types efficaces), récompenses, mini-jeux,
│   │                          intervalles de spawn, rareté, événement quotidien (dailyEvent),
│   │                          release.notesFile (chemin du patch note markdown)
│   └── database.json          Nom de la base et des collections (l'URI est dans le .env)
├── data/
│   └── pokemonLight.csv       Données Pokémon (noms EN/FR, types FR, taux de capture) — 251 Pokémon (générations 1+2)
├── src/
│   ├── commands/              Une commande Discord par fichier + index.js
│   │   ├── index.js           Centralise les exports et les metadata (pour !help)
│   │   ├── shop.js            Achat de balls (collector 15 s, achat atomique en BDD)
│   │   ├── capture.js         Délègue le flux à CaptureService
│   │   ├── game.js            Mini-jeux (jetons horaires)
│   │   ├── work.js            Partir travailler (paye après 1 h)
│   │   ├── egg.js             Œuf : obtention et état d'éclosion
│   │   ├── event.js           Progression de l'événement quotidien (!event)
│   │   └── ...                money, balls, pokedex, classement, casino, admin, ping, help
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
│   │   ├── Ball.js            Une ball avec son prix, son rate et ses types efficaces
│   │   └── Pokemon.js         Un Pokémon (numéro, nom, types)
│   ├── services/              Logique métier — c'est ici que vit le jeu
│   │   ├── bdd/BDDService.js  Unique point d'accès à MongoDB : CRUD générique +
│   │   │                      méthodes métier (captures, argent, balls, travail, œuf, event)
│   │   ├── capture/CaptureService.js   Flux de capture : inventaire, choix de la
│   │   │                                ball, tirage, mise à jour du Pokédex
│   │   ├── channel/ChannelService.js   Messagerie centralisée : sendMessage vers le
│   │   │                                channel principal, replySafe pour répondre
│   │   │                                aux commandes
│   │   ├── economy/           MoneyService, InventoryService, WorkService, CasinoService
│   │   ├── egg/EggService.js  Œuf : progression, tirage de l'éclosion (2/3 non obtenu),
│   │   │                      messages et GIF d'éclosion
│   │   ├── event/DailyEventService.js  Événement quotidien collaboratif (points,
│   │   │                                objectif scalable, récompenses, reset 2 h)
│   │   └── game/              GameService (jetons horaires), SpawnService
│   │                          (spawns aléatoires, 1 % de légendaires)
│   └── utils/                 Utilitaires sans état
│       ├── configLoader.js    Charge gameConfig.json et la config BDD (.env)
│       ├── parsing.js         Lecture du CSV Pokémon (index des colonnes)
│       ├── phrasesAleatoires.js  Pool de phrases avec substitution {clef}
│       ├── livingdex.js       Lien LivingDex (dex Johto 251 slots, schéma v2 de l'app)
│       └── gif.js             Stickers animés Giphy (filtrés sur le compte officiel Pokémon)
├── tests/                     Suite de tests (node --test, MongoDB en mémoire)
├── .env                       Secrets et configuration locale — jamais commité
├── .env.example               Template des variables d'environnement à remplir
├── PATCHNOTE.md               Patch note (markdown) annoncé au démarrage — release.notesFile dans gameConfig.json
├── TEASER-v1.7.0.md           Annonce de la prochaine version (génération 2, event, balls)
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
- **Les compteurs en base** (argent, balls, `nbrCapture`, Pokédex compact `dexBits`/`dexCount`, points d'event) sont mis
  à jour de façon atomique (`$inc`, `$set` ciblés) pour résister aux actions simultanées.

## Variables d'environnement

Voir `.env.example` : token Discord, ID du channel principal, URI MongoDB, nom de la
base, clé API Giphy. Sur un hébergeur (Railway, etc.), les renseigner dans le
tableau du service plutôt que de déployer un fichier `.env`.
