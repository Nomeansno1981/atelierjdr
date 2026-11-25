# Atelier

Outil personnel pour planifier et rédiger le manuel de *Katastrophê* : un chemin de fer (le plan du livre, page par page) et un éditeur Markdown. Le site est statique, hébergé sur GitHub Pages ; le manuscrit vit dans un dépôt GitHub privé, en fichiers Markdown lisibles sans l’Atelier.

> **État : jalon 5 (sorties).** Plan, éditeur, typographie, lecture continue, compilation (site et script Python identiques) et export .zip sont en place. Le jalon 6 portera sur la robustesse : conflits entre appareils, installation sur l’écran d’accueil, sécurité.

## Les deux dépôts

| Dépôt | Contenu | Visibilité |
| --- | --- | --- |
| `atelier` | Ce code. GitHub Pages le publie automatiquement. | Public (aucun texte du manuel) |
| `katastrophe` | Le manuscrit : `plan.json` et `sections/*.md` | **Privé** |

### 1. Créer le dépôt du manuscrit (`katastrophe`)

1. Sur GitHub, cliquez sur **+** en haut à droite, puis **New repository**.
2. Nom : `katastrophe`. Visibilité : **Private**.
3. Cochez **Add a README file**. C’est indispensable : l’API qu’utilise l’Atelier ne sait pas écrire dans un dépôt entièrement vide.
4. Cliquez sur **Create repository**.

Pour essayer l’Atelier avec le manuscrit d’exemple, copiez-y le contenu du dossier `exemple/` de ce dépôt (le fichier `plan.json` et le dossier `sections/`), soit :

- **dans le navigateur** : sur la page du dépôt `katastrophe`, **Add file → Upload files**, puis glissez `plan.json` et le dossier `sections` ; validez avec **Commit changes** ;
- **en ligne de commande**, depuis le dossier qui contient le clone d’`atelier` :

```bash
git clone https://github.com/VOTRE-NOM/katastrophe.git
```

```bash
cp -R atelier/exemple/plan.json atelier/exemple/sections katastrophe/
```

```bash
cd katastrophe && git add . && git commit -m "Manuscrit d’exemple" && git push
```

### 2. Créer le jeton d’accès

Le jeton est la clé qui permet au site de lire et d’écrire le manuscrit. Il est limité au seul dépôt `katastrophe`.

1. Sur GitHub : votre photo en haut à droite → **Settings** → **Developer settings** (tout en bas de la colonne de gauche) → **Personal access tokens** → **Fine-grained tokens** → **Generate new token**.
2. **Token name** : par exemple `Atelier`.
3. **Expiration** : choisissez une date. À l’échéance, l’Atelier vous demandera un nouveau jeton, sans rien perdre.
4. **Repository access** : **Only select repositories**, puis choisissez `katastrophe` uniquement.
5. **Permissions** → **Repository permissions** → **Contents** : **Read and write**. (La permission *Metadata* en lecture s’ajoute d’elle-même.) Ne donnez aucune autre permission.
6. **Generate token**, puis copiez le jeton (il commence par `github_pat_`). GitHub ne le montrera plus.

Le jeton est saisi une fois par appareil et ne quitte jamais l’appareil. Ne le mettez jamais dans un fichier du dépôt.

### 3. Publier le site (`atelier`)

1. Créez un dépôt **public** nommé `atelier` et poussez-y ce code.
2. Dans ce dépôt : **Settings** → **Pages** → **Build and deployment** → **Source** : **GitHub Actions**.
3. Chaque envoi sur la branche `main` lance les tests puis publie le site. Suivez l’avancement dans l’onglet **Actions**. Le site est publié seulement si tous les tests passent.
4. Adresse du site : `https://VOTRE-NOM.github.io/atelier/`.

Le site ne contient aucun texte du manuel : sans jeton, il n’affiche que l’écran de connexion, et il demande aux moteurs de recherche de ne pas l’indexer.

### 4. Se connecter

Ouvrez le site, saisissez `VOTRE-NOM/katastrophe` et le jeton. La liste des sections s’affiche. Une copie du manuscrit est gardée sur l’appareil : si GitHub ne répond pas, le site affiche cette copie.

## Utiliser le plan

Le plan est un chemin de fer : chaque section est un post-it qui couvre autant de pages que son budget. On choisit l’**ordre** des sections ; les pages se calculent, pages blanches comprises (une section qui doit commencer à gauche ou à droite en insère une si nécessaire).

| Action | Souris | Doigt | Clavier |
| --- | --- | --- | --- |
| Déplacer une section | Glisser le post-it | Appui long (un tiers de seconde), puis glisser | Espace, flèches, puis Espace ou Entrée (Échap annule) |
| Modifier | Bouton « … » | Bouton « … » | Tab jusqu’au bouton, Entrée |
| Changer le nombre de pages | Boutons − et + | Boutons − et + | |
| Créer une section | « + » au bord gauche d’un post-it (avant lui) ou « Nouvelle section » en fin de grille | idem | |
| Annuler, rétablir | Boutons en haut à gauche | idem | Cmd/Ctrl+Z, Cmd/Ctrl+Maj+Z |

- **Supprimer** se fait depuis le panneau « … » : la section part dans la corbeille, et un bandeau « Annuler » reste 10 secondes. La corbeille (icône en haut à droite) permet de restaurer une section à sa place. La vider demande confirmation et ne s’annule pas ; les fichiers restent dans l’historique GitHub.
- **Couleur** du post-it : son statut (gris à écrire, jaune premier jet, bleu relu, vert définitif). **Étiquette** en haut : sa partie.
- **Jauge** : mots écrits sur la cible (pages × mots par page) ; elle vire au rouge au-delà de 110 %.
- **Pages hachurées** : en gris, une page blanche insérée automatiquement ; en rouge, une page au-delà du nombre de pages prévu.
- **Réglages** (icône à curseurs) : titre, nombre de pages, mots par page, parties. La déconnexion s’y trouve aussi.
- **Enregistrement** : chaque modification est écrite sur l’appareil immédiatement, puis envoyée à GitHub environ 5 secondes après la dernière, en un seul commit. L’indicateur en haut à droite dit où elle en est.
- **Conflit** : si le plan a été modifié sur un autre appareil pendant que vous travailliez, un bandeau vous laisse choisir la version à garder. L’autre reste dans l’historique GitHub.

Toucher une section de texte ouvre l’éditeur ; toucher un hors-texte ouvre son panneau.

## Écrire

L’éditeur montre le Markdown brut, avec un léger rendu : intertitres plus grands, gras et italique visibles, signes de syntaxe atténués. Le correcteur orthographique du navigateur est réglé sur le français.

- **En haut** : retour au plan, liste des sections (colonne à gauche sur ordinateur, bouton « Sections » sur tablette et téléphone), état de l’enregistrement.
- **Sous le titre** : statut, pages, compteur « mots / cible » en direct, sections précédente et suivante, recherche, mode concentration.
- **Intertitres** : commencez à `###`. Les titres `#` et `##` sont réservés à la compilation ; l’éditeur les souligne en rouge.
- **Raccourcis** : Cmd/Ctrl+B gras, Cmd/Ctrl+I italique, Cmd/Ctrl+S envoyer tout de suite, Cmd/Ctrl+F chercher dans la section, Cmd/Ctrl+Maj+F chercher dans tout le manuscrit (sans tenir compte des majuscules ni des accents).
- **Enregistrement** : le texte est écrit sur l’appareil moins d’une seconde après la frappe, puis envoyé à GitHub après 30 secondes sans frappe, en quittant la section, en revenant au plan, sur Cmd/Ctrl+S, ou quand l’onglet passe en arrière-plan. Un réseau coupé ou un onglet fermé ne fait rien perdre : tout part au retour du réseau.
- **Conflit** : si la même section a été modifiée sur un autre appareil, rien n’est écrasé. La version de cet appareil est sauvegardée dans `conflits/` du dépôt, celle de GitHub reste en place, et un bandeau vous laisse choisir laquelle garder.
- **Historique** : un lien sous le texte ouvre l’historique de la section sur GitHub.
- **Outils** (menu sous le titre) : recherche dans le manuscrit, normalisation de la typographie, affichage des espaces insécables, mode concentration.

## Typographie française

Pendant la frappe, l’éditeur applique la convention du projet :

| Vous tapez | Vous obtenez |
| --- | --- |
| `l'acte` | `l’acte` (apostrophe typographique) |
| `"Oui"` | `« Oui »`, avec des espaces insécables à l’intérieur |
| `Non !` ou `Non!` | `Non !`, avec une espace insécable avant `: ; ! ?` |
| `Attends...` | `Attends…` |

- Un **Cmd/Ctrl+Z** juste après annule la seule substitution et rend le caractère tapé.
- **Rien n’est touché** dans le code, les adresses de liens et d’images, les URL, les heures et les rapports (`14:30`, `3:2`), ni le `!` d’une image. Aucun tiret n’est jamais converti.
- **Réglages** : chaque règle s’active ou se désactive à part, et l’espace fine insécable (U+202F) peut remplacer l’insécable ordinaire devant `; ! ?`. Ces réglages sont enregistrés dans `plan.json` : ils valent sur tous vos appareils.
- **Montrer les espaces insécables** (menu Outils, ou Réglages) les affiche sur un léger fond gris. Ce réglage est propre à chaque appareil.
- **Normaliser** applique les mêmes règles à un texte déjà écrit : une section depuis le menu Outils, ou tout le manuscrit depuis les Réglages. Le nombre de remplacements est annoncé avant d’appliquer. Normaliser deux fois ne change rien de plus.
- Les **titres et résumés** suivent la même convention quand vous les validez.

**Sur iPhone et iPad**, désactivez la « Ponctuation intelligente » d’iOS (Réglages › Général › Clavier) : elle transforme `--` en tiret cadratin, ce que la convention du projet exclut. Les guillemets anglais qu’elle pose sont, eux, convertis en guillemets français par l’Atelier.

## Lire, compiler, exporter

Ces trois fonctions sont dans le menu **Outils** du plan.

- **Lecture continue** : toutes les sections à la suite, mises en page pour la lecture, avec les titres de parties et de sections placés comme à la compilation, les hors-texte en encadré et, sous chaque titre, ses pages et ses mots. La table des matières (à gauche, ou « Sommaire » sur téléphone) mène à une section ; toucher le titre d’une section l’ouvre dans l’éditeur. Une case masque les sections « à écrire » encore vides. Lecture seule.
- **Compiler** produit un seul fichier Markdown pour le pipeline Python puis InDesign. Il propose le numéro de version suivant, laisse inclure ou exclure les sections vides et ajouter des repères de pages, puis télécharge le fichier ou l’enregistre dans `compilations/` du dépôt. Le nom suit le modèle `Katastrophe__v{n}.md`, modifiable dans les Réglages.
- **Exporter le manuscrit (.zip)** télécharge `plan.json`, les sections, la corbeille et le script de compilation, depuis l’appareil : cela marche même si GitHub ne répond pas, et l’archive contient aussi les modifications pas encore envoyées.

### Format de la compilation

```
# Partie I — Présentation

<!-- HORS-TEXTE : Page de titre (p. 1) -->

## Avant-propos

Texte exact de la section…

# Lexique

## Lexique
<!-- pages 18-19 -->

Texte…
```

Le texte des sections n’est jamais modifié, typographie comprise ; seuls les sauts de ligne en fin de texte sont retirés. Une ligne vide sépare deux blocs ; le fichier est en UTF-8, avec des fins de ligne LF et un seul saut de ligne final. Les repères `<!-- pages … -->` n’apparaissent que si on les demande.

### Compiler sans le site : `outils/compiler.py`

Le dépôt du manuscrit contient `outils/compiler.py` (l’Atelier l’y met à jour à chaque compilation enregistrée dans le dépôt). Il produit **exactement** le même fichier que le site, octet pour octet, à partir d’un simple clone, sans rien installer d’autre que Python 3 :

```bash
python3 outils/compiler.py
```

```bash
python3 outils/compiler.py --version 27 --sans-vides --reperes
```

Sans `--version`, il prend la version suivant la plus haute trouvée dans `compilations/`. `--sortie -` écrit sur la sortie standard. Un test automatique de l’Atelier compare les deux sorties à chaque modification.

## Installer sur iPhone et iPad

1. Ouvrez l’adresse du site dans **Safari**.
2. Touchez le bouton **Partager**, puis **Sur l’écran d’accueil**, puis **Ajouter**.
3. Ouvrez l’Atelier depuis l’icône et **saisissez le jeton dans l’application installée** : elle ne partage pas son stockage avec Safari.

L’installation protège aussi le cache : Safari peut effacer les données d’un site non installé après sept jours sans visite. Le site lui-même a besoin du réseau pour s’ouvrir : il n’est pas prévu pour fonctionner en mode avion.

## Développement

Prérequis : Node.js 22.

```bash
npm install
```

```bash
npm run dev
```

| Commande | Effet |
| --- | --- |
| `npm run dev` | Serveur de développement sur http://localhost:5173 |
| `npm test` | Tests unitaires (Vitest) |
| `npm run test:e2e` | Tests de bout en bout (Playwright), en tailles ordinateur, tablette et téléphone |
| `npm run lint` | Vérification du code (ESLint, TypeScript strict) |
| `npm run build` | Construction du site dans `dist/` |

Les tests de bout en bout tournent sur la version construite, avec la politique de sécurité du contenu active, et parlent à un faux GitHub : ils n’ont besoin ni de réseau ni de jeton.

### Organisation du code

```
src/
├── domaine/     logique pure, sans interface, entièrement testée (plan, numéros romains…)
├── github/      accès à l’API GitHub et synchronisation
├── stockage/    cache IndexedDB
├── etat/        état de l’application, indépendant de React
├── ui/          composants React
├── styles/      CSS (thème clair et sombre)
└── test/        outils de test (faux GitHub, manuscrit d’exemple)
exemple/         manuscrit d’exemple : 10 sections, 3 parties, 2 hors-texte
e2e/             tests Playwright
```
