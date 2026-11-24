# Atelier

Outil personnel pour planifier et rédiger le manuel de *Katastrophê* : un chemin de fer (le plan du livre, page par page) et un éditeur Markdown. Le site est statique, hébergé sur GitHub Pages ; le manuscrit vit dans un dépôt GitHub privé, en fichiers Markdown lisibles sans l’Atelier.

> **État : jalon 2 (mode plan).** Le chemin de fer est en place : grille en doubles pages, pagination, post-its, glisser-déposer, création, modification, corbeille, annulation. Les modifications du plan sont enregistrées sur l’appareil puis envoyées à GitHub. L’éditeur de texte arrive au jalon 3.

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

En attendant l’éditeur (jalon 3), toucher une section de texte ouvre son panneau de modification.

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
