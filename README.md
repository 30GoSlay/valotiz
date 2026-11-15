# Avatar Tactique

Un **FPS tactique 3D à sprites 2D** (à la **Valorant**) utilisant les **avatars** de Chapaland/Chapatiz.

**FPS Tactique** (`fps/`) — **2v2 / 5v5**, grande map blockout (bâtiment central + lanes qui cassent la ligne de vue
spawn-à-spawn). **Deux maps « Station » sci-fi qui alternent à chaque partie** (même structure, collisions, sites et
spawns — seul le visuel change), habillées à partir du kit modulaire **Ultimate Modular Sci-Fi** (Quaternius, CC0) :
panneaux muraux tilés (InstancedMesh → ~40 draw calls), colonnes, évents, caisses métal, sol à grille néon, dôme sombre.
- **Station Alpha** — accent **cyan**, éclairage froid.
- **Station Bravo** — accent **orange**, éclairage chaud.

En solo la map alterne à chaque partie ; en ligne elle est **dérivée du seed serveur** (même map pour tous les joueurs).
**Saut** (on peut monter sur les caisses), tir hitscan avec headshot.

- **Spike (pose / désamorçage)** en solo : les attaquants arment la Spike sur un site (**maintien [E]**, ~3,2 s) ; mèche de
  **40 s** → si elle explose, les attaquants gagnent la manche ; les défenseurs peuvent **désamorcer** (~6,5 s, palier 50 %).
  Après la pose, tuer tous les attaquants ne suffit plus : il faut désamorcer avant l'explosion. HUD dédié (barre de pose /
  désamorçage, minuteur de Spike qui accélère). Les bots jouent l'objectif (attaquants convergent et arment, défenseurs retake).
- **HUD du haut type Valorant** : portraits des deux équipes (PV + vivants/morts), scores, et **timer de manche de 2:00**
  au centre (si le temps s'écoule **avant la pose**, la défense gagne la manche).
- **Sprites directionnels** : on voit l'orientation réelle des avatars (face / dos / profil selon leur déplacement et leur
  visée) au lieu qu'ils fixent tous le joueur.
- **IA compétitive** : visée crédible (précision selon distance / mouvement / temps de visée / skill), temps de réaction
  réaliste (ré-acquisition plus rapide s'ils sont déjà en alerte), usage des couvertures, repli pour recharger, rôles
  (défenseurs qui tiennent les sites, attaquants qui poussent), **évitement des murs** (ils ne se coincent plus).
  **3 niveaux de difficulté** (Facile / Normal / Difficile) réglant réaction, précision et headshots — Difficile est
  volontairement punitif. Map retravaillée avec **plus de couverture** (sorties de spawn + chicanes de lane) pour casser
  les longues lignes de tir au sniper.
- **Mort → spectateur** : à l'élimination, la caméra suit un coéquipier vivant (clic = joueur suivant).
- **Ambiance soirée** : ciel crépusculaire avec coucher de soleil à l'horizon, lanternes chaudes (fixées aux murs).
- **IA « comme un vrai joueur »** : jiggle-**peek** depuis les couvertures, **counter-strafe** (s'arrête net pour tirer, donc
  précis), pré-visée des angles, réaction quasi-humaine, **niveau élevé** (skill 0.86–0.99, visée tête) pour une vraie
  compétition.
- **Menu Paramètres** (touche **Échap**, met le jeu en pause en solo) : volume, sensibilité X / Y, sensibilité à la lunette,
  champ de vision (FOV), inversion de l'axe Y — réglages **sauvegardés** (localStorage).
- **Rendu stylisé** (cartoon Valorant) : murs et caisses **texturés** (panneaux peints, liseré d'accent, lueur), par thème.
- **Kill feed type Valorant** en haut à droite : tueur ⟶ victime, **noms colorés par équipe**, carte rouge + ✸ pour les
  headshots, nouvelle ligne en haut qui fait défiler.
- **Perf** : suppression des lumières ponctuelles par lanterne, ombres allégées (1024), rendu « high-performance ».
- **Netcode** : **interpolation** des joueurs/bots distants (mouvement lissé au lieu de téléportations).
- **5v5 en ligne (vrai multijoueur WebSocket)** : un **serveur** (`server.mjs`, zéro dépendance) gère le matchmaking 5v5,
  le lobby et le relais ; le 1er connecté est l'**hôte** (son client simule les bots et les manches). Si le serveur est
  injoignable, le mode bascule en entraînement contre des bots. Fonctions en ligne :
  - **Pseudo** mémorisé (navigateur) + **jeton joueur** permanent (base des stats).
  - **Lobby** : on attend **2 vrais joueurs** (puis départ en 8 s) ; sinon on **complète avec des bots au bout de 60 s**.
  - **K/D/A en ligne** suivi par l'hôte et affiché au **Tab** (bots inclus).
  - **ELO** (persisté dans `data.json` côté serveur) : il ne bouge que si **chaque équipe a ≥ 1 humain** (sinon gelé, c'est
    de l'entraînement vs bots). **Classement 🏆** consultable depuis le menu.
  - **Codes de salon** : saisis le même code pour tomber dans la partie de tes amis.
- **Trois armes** (touches 1-3, molette pour changer) : **1 Operator** (sniper, un coup = un kill, **lunette en bascule
  au clic droit**), **2 Pistolet** (semi-auto), **3 Vandale** (fusil auto).
- **Animation de rechargement** : l'arme plonge, s'incline puis revient (procédurale, le bundle n'a pas d'anim bakée).
- **Pack de sons réel** (tir, recharge, headshot, annonces de manche).
- **Tableau des scores** (maintenir **Tab** : portraits, K/D/A, ping).
- **Bannières style Valorant** : séries de kills (**DOUBLE / TRIPLE / QUADRA KILL**, **ACE** avec gemme + barres),
  **CLUTCH** (dernier survivant qui gagne la manche), et écran de fin **VICTORY / DEFEAT** + badge **MVP** (top fragger).
  Sons d'annonce qui montent à chaque kill — jusqu'au son **ACE** à 5 kills.

Premier à **5 manches**.

- **Éditeur de map** (`fps/editor.html`, ou bouton **« 🛠 Éditeur de map »** au menu) : vue de dessus 2D pour placer
  **murs / caisses / blocs** (déplacer, redimensionner, **tourner**), **spawns** att/déf, **sites** A/B, **décors**
  (lanternes, plantes, tonneaux) et **lumières**, avec choix de **matériau** par bloc, **thème** Pearl/Haven,
  **aperçu 3D**, **annuler/refaire**, et **sauvegarde** (localStorage) + **export/import `.json`** pour partager ses maps.
  Bouton **« ▶ Jouer »** pour tester sa map tout de suite ; au menu, **« 🗺 Mes maps »** liste les maps sauvegardées.

Du projet d'origine, on ne garde qu'**une seule chose : la génération d'avatar** (Ruffle + `rasterizer.swf`), qui
transforme une chaîne « ad » en avatar. Le reste (tchat, site, modération…) n'est pas repris.

Les armes en vue FPS sont des **modèles 3D texturés** chargés via `GLTFLoader` (Three.js en module ES + import map).
Le bundle fourni `fps/models/kuronami.glb` contient plusieurs armes ; le jeu en **extrait par nom** l'**AK** (→ Vandale) et le
**LeverSniper** (→ Operator). Les poses sont réglables dans `index.html` via `RIFLE_POSE` et `OP_POSE` (position, rotation, échelle).
Modèles tiers (bundle Valorant « Kuronami », Sketchfab) — à n'utiliser qu'en privé, crédit auteur requis en cas de diffusion.

## Ce qu'il y a dedans

```
avatar-br/
├── index.html             ← redirige vers le FPS
├── fps/index.html         ← FPS Tactique (Three.js, un seul fichier)
├── fps/avatars/           ← PNG des avatars + roster.json (générés)
├── fps/sounds/            ← pack de sons (mp3)
├── fps/killbadges/        ← badges de série de kills (png)
├── avatars/               ← LA génération d'avatar conservée
│   ├── gen.mjs            ← génère un roster d'avatars (feuilles de sprites animées)
│   ├── lib/               ← rasterizer : raster.mjs, atlas.mjs, pf.mjs
│   └── public/            ← page.html (hôte Ruffle) + rasterizer.swf
├── serve.mjs              ← mini serveur statique local
├── package.json
└── README.md
```

## 1. Jouer tout de suite

Les avatars sont déjà générés. Sers le projet (le jeu charge `roster.json` via `fetch`, donc `file://` ne marche pas) :

```bash
node serve.mjs         # → http://localhost:8090  (redirige vers /fps)
```

- **FPS Tactique** : choisis **2v2** ou **5v5** au menu. **WASD** bouger, **Espace** sauter, **souris** viser (pointer-lock,
  la norme FPS), **clic** tirer, **1 / 2** changer d'arme (Vandale / Operator), **clic droit** lunette (sniper),
  **R** recharger, **Maj** marcher (plus précis), **Tab** (maintenu) = tableau des scores.
  Élimine l'équipe adverse ; premier à 5 manches. Headshot = kill instantané. Sons réels (pack d'effets) dans `fps/sounds/`.

## 2. Jouer en ligne (5v5 multijoueur)

Le multijoueur a besoin de **deux process** : le serveur de jeu statique (`serve.mjs`) et le serveur temps réel WebSocket
(`server.mjs`). Les deux sont en **Node pur, sans dépendance**.

```bash
node server.mjs      # serveur temps réel  → ws://0.0.0.0:8091
node serve.mjs       # sert le jeu         → http://localhost:8090
```

- Sur la **même machine / le même réseau** : chaque joueur ouvre `http://<ip-de-l-hôte>:8090`, clique **« 5v5 EN LIGNE »**,
  et le lobby les regroupe. Le client se connecte automatiquement à `ws://<même-hôte>:8091`.
- Le **1er connecté est l'hôte** : il peut lancer tout de suite (**Démarrer maintenant**) ou laisser le compte à rebours
  compléter avec des bots. Chaque joueur contrôle son avatar ; on se voit, on se tire dessus, K/D/A et manches sont synchronisés.
- ⚠️ Depuis l'artefact **hébergé** (claude.ai, en https), le navigateur bloque `ws://localhost` : le mode en ligne
  fonctionne en **local** (projet lancé avec `serve.mjs` + `server.mjs`). Pour jouer entre amis sur Internet, héberger
  `server.mjs` sur un serveur public (et viser `wss://` derrière un reverse-proxy TLS).
- Port du serveur WS configurable : `WS_PORT=9000 node server.mjs`.

### Héberger sur un VPS (via git)

Flux **ta machine → GitHub → VPS** (`git clone` puis `git pull`). Pas besoin de `npm install` pour jouer (serveurs en
Node pur). Toutes les commandes (préparation du VPS, clone, systemd, nginx+HTTPS, mises à jour en une commande) sont dans
**[`DEPLOY.md`](DEPLOY.md)**. Mise à jour express : `VPS=root@IP ./deploy/deploy.sh "message"` (push + pull + restart).

## 3. Regénérer / changer les avatars

La génération a besoin de la **bibliothèque d'items SWF** (`new_lib`, ~18 000 fichiers) et, pour des tenues variées, du
catalogue `items.json`. Les deux viennent du projet Chapaland.

```bash
npm install

# depuis une copie locale de new_lib :
LIB=/chemin/vers/new_lib CATALOG=/chemin/vers/catalog/items.json \
  RASTER_GPU=off CHROMIUM_PATH=$(node -e "console.log(require('playwright').chromium.executablePath())") \
  node avatars/gen.mjs 18

# ou depuis la lib distante (pas besoin de new_lib local) :
LIB=https://01static.chapatiz.com/fr/swf/new_lib/ CATALOG=./items.json node avatars/gen.mjs 18
```

Ça écrit `game/avatars/avNN.png` + `game/avatars/roster.json`. Le jeu prend automatiquement tous les avatars listés.

- `LIB` : dossier `new_lib` **ou** URL distante de la lib SWF (obligatoire).
- `CATALOG` : `items.json` pour des tenues aléatoires valides (sinon, avatars de base unis).
- `ZOOM` : taille du rendu (défaut 2). `COUNT` : 1er argument (défaut 18).
- `RASTER_GPU=off` : rendu sur GPU logiciel (SwiftShader), fiable en headless.
- `CHROMIUM_PATH` : chemin du Chromium de Playwright si l'auto-détection échoue.

### Mettre un avatar précis

Dans `avatars/gen.mjs`, remplace `randomAd()` par une chaîne « ad » fixe (14 champs `base;item1;…;item13`), par ex.
`"11583;444;16594;1586;0;18778;999;0;5771;0;16602;0;0;0"`. La 1re entrée de `roster.json` est l'avatar du **joueur** ;
les suivantes sont les bots.

## Comment marche le jeu (résumé)

- **Sprites billboard animés** : chaque avatar est un plan texturé par sa **feuille de sprites**, toujours orienté face à
  la caméra autour de l'axe Y (technique « DOOM »), posé sur un sol 3D. On choisit la **direction** (haut/bas/gauche/droite,
  gauche = droite en miroir) selon le déplacement/la visée et on **fait défiler les frames de marche** ; `NearestFilter`
  pour garder le net. Les frames viennent directement des anims `Up/Down/Right/Inactive` de l'atlas (cf. `gen.mjs`).
- **Caméra fixe 3/4 (twin-stick)** qui suit le joueur sans tourner ; visée à la souris (raycast sur le sol), pas de pointer-lock.
- **Bots** : IA simple (approcher / tourner autour / tirer ; rejoindre la zone s'ils sont dehors).
- **Zone** : un cylindre qui rétrécit par paliers ; hors zone, on perd des PV.
- Tout est dans un seul `index.html`, Three.js chargé depuis un CDN. Aucune compilation.

## Pistes

- Plusieurs poses (course, saut) en sprite-sheet au lieu d'une image fixe.
- Armes / objets à ramasser, soins, murs destructibles.
- Multijoueur (WebSocket) : l'architecture avatar+billboard s'y prête bien.
