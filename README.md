# Flip 7

Le jeu de cartes **Flip 7**, en local, sans compte ni serveur. C'est une PWA : une fois chargée, elle fonctionne hors ligne et s'installe sur l'écran d'accueil de l'iPad ou de l'iPhone.

## Jouer

- **2 à 6 joueurs**, chacun *Humain* ou *Ordi* (réglable dans le menu).
- **Face à face** : iPad posé à plat, les joueurs du haut ont leur zone et leurs boutons retournés à 180°. Chacun appuie sur ses propres boutons.
- **Passe-passe** : tout est visible de tous (comme à la table), il suffit de se passer l'appareil.
- Objectif réglable : 100, 200 (défaut) ou 300 points.

## Règles implémentées

- Paquet de 94 cartes : numéros 0 à 12 (autant d'exemplaires que la valeur, un seul 0), +2 / +4 / +6 / +8 / +10, ×2, 3 Gel, 3 Triple pioche, 3 Seconde chance.
- Piocher ou rester ; un doublon fait sauter (0 point), sauf avec une Seconde chance.
- **Gel** et **Triple pioche** visent un joueur actif au choix, soi-même compris. Pendant une Triple pioche, les Gel / Triple pioche tirés sont résolus après les trois cartes.
- **Flip 7** : 7 numéros différents = +15 points, la manche s'arrête, tous les joueurs non sautés marquent leur main.
- Le ×2 double les numéros, les bonus +N s'ajoutent ensuite.
- Fin de partie à la fin de la manche où quelqu'un atteint l'objectif ; égalité en tête = manche supplémentaire.

## Installer sur iPad / iPhone

1. Ouvrir l'adresse du jeu dans Safari.
2. Bouton Partager → **Sur l'écran d'accueil**.

## Mise en ligne (GitHub Pages)

Dépôt → Settings → Pages → Source : *Deploy from a branch*, branche `main`, dossier `/ (root)`.
L'adresse sera `https://<utilisateur>.github.io/Flip7/`.

## Fichiers

| Fichier | Rôle |
|---|---|
| `engine.js` | Règles et ordinateur, sans DOM (testable sous Node) |
| `app.js` | Interface |
| `style.css` | Mise en page |
| `sw.js`, `manifest.webmanifest`, `icons/` | PWA |

Pour modifier le jeu hors ligne après une mise à jour, incrémenter `VERSION` dans `sw.js`.
