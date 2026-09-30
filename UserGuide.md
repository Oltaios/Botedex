# Guide du dresseur — Botedex

> Bien le bonjour ! Bienvenue dans le monde magique des POKEMONS !
> Mon nom est le Botedex, mais les gens m'appellent le PROF POKEMON !
> Ce monde est peuplé de créatures du nom de POKEMONS !
> Pour certains, les POKEMONS sont des animaux domestiques, pour d'autres ils sont un moyen de combattre.
> Pour ma part... L'étude des POKEMONS est ma profession.
> Ta quête des POKEMONS est sur le point de commencer, un tout nouveau monde de rêves, d'aventures et de POKEMONS t'attend ! Dingue !
>
> Avant de démarrer ton périple, voici un petit guide sur comment se déroulera ton aventure.

---

## Le monde du Botedex

### Un seul et unique channel

Toute l'aventure se déroule sur la channel principale du Botedex. Si tu m'écris ailleurs,
je ferai semblant de ne rien voir. Un PROF a besoin de concentration.

### Apparitions des Pokémon

Les POKEMONS apparaissent de manière aléatoire sur la channel, à intervalles plus ou moins
réguliers. À chaque apparition, une annonce est faite (avec un petit sticker pour te mettre
dans l'ambiance).

**Règle importante :** seul le POKEMON apparu en dernier peut être capturé. Dès qu'une
tentative de capture se termine (réussie **ou** ratée), il s'en va ! Le prochain arrivé
attendra son tour.

### Comment capturer un POKEMON ?

1. Saisis `!capture` dans le chat.
2. Le Botedex t'affiche ton inventaire et te demande quelle ball lancer.
3. Réponds dans les **15 secondes** par `!pokeball`, `!superball` ou `!hyperball`.

Quelques précisions de labo :

- La ball n'est consommée que si tu en as en stock — sinon le Botedex te renvoie au shop.
- La `!superball` (15 $) et l'`!hyperball` (20 $) augmentent tes chances par rapport à
  la `!pokeball` (10 $).
- Si tu captures un POKEMON que tu possèdes déjà, tu revends ses organes à la Team Rocket
  pour **250 Pokédollars**. La science est parfois cruelle.
- Pendant que tu choisis ta ball, tes autres commandes sont ignorées. Reste concentré, dresseur.

---

## Les commandes

| Commande | Effet | Détail |
|---|---|---|
| `!jeVeuxJouerStp...` | Créer ton compte | Obligatoire pour jouer |
| `!capture` | Capturer le Pokémon apparu | Voir section ci-dessus |
| `!work` | Partir travailler | 100 $ après 1 heure |
| `!money` | Consulter ton solde | |
| `!balls` | Consulter ton inventaire de balls | |
| `!game` | Mini-jeu « devine le type » | 100 $ si tu gagnes |
| `!pokedex` | Nombre de POKEMONS capturés | Pour flex en grande légende |
| `!shop` | Acheter des balls | Voir section ci-dessous |
| `!gif` | Sticker Giphy sur un mot-clé | |
| `!help` | Liste des commandes | Pour les tête en l'air |
| `!ping` | Vérifier que le bot est réveillé | Il répond Pong. C'est tout. |
| `!startSpawn` | Relancer les apparitions | Réservée au PROF |

### `!jeVeuxJouerStpCreeMoiUnComptePourquoiCetteCommandeEstSiLongueJeHaisLesDevs`

Ta première commande pour t'enregistrer ! Elle est essentielle car sans elle tu ne pourras
rien faire. (Et non, il n'y a pas de version plus courte du nom, le dev a une panne
d'inspiration.)

### `!work`

Tu pars travailler pour une durée d'**une heure** afin de générer **100 Pokédollars**.
Reviens quand la cloche sonne, ta paye est versée automatiquement.

### `!game`

Un POKEMON apparaît, tu devras deviner son **type** !

- Exemple : si Evoli apparaît, réponds `!normal`.
- Pour un double type comme Bulbizarre, réponds `!grass/poison` — l'ordre n'importe pas
  (les devs sont sympas).
- Tu as **30 secondes** et **3 essais**.
- Une seule partie par heure : à chaque début d'heure, tout le monde peut rejouer.
- Trouve le bon type et **100 Pokédollars** sont à toi !

### `!shop`

Le magasin de balls ! Après `!shop`, passe commande dans les **15 secondes** au format
`!<type de ball><nombre>` :

| Ball | Prix |
|---|---|
| `!pokeball` | 10 $ |
| `!superball` | 15 $ |
| `!hyperball` | 20 $ |

Par exemple : `!superball5` pour cinq superballs.

- Si le nombre est absent ou invalide, tu en achèteras **une seule**.
- Bien évidemment, tu devras disposer des fonds nécessaires — pas de kopek, pas de balls.
- La queue est longue derrière toi, dépêche-toi gamin.

### `!pokedex`

Consulte le nombre de POKEMONS capturés pour flex en grande légende. (Une capture d'un
POKEMON déjà possédé compte aussi dans ton palmarès de chasseur, tu comprendras.)

---

*Le Botedex et ce guide sont maintenus avec amour et approximativement la rigueur
d'un vrai laboratoire.*
