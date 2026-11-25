# Launcher Minecraft (Fabric 26.2)

| Dossier | Rôle |
|---|---|
| `launcher/` | L'application Windows (.exe) |
| `docs/` | Le site admin (GitHub Pages) |
| `supabase/` | La base de données |
| `.github/workflows/` | La fabrication du .exe et les mises à jour |

Suis les étapes dans l'ordre.

## 1. Supabase

1. **SQL Editor** : colle tout `supabase/schema.sql`, puis **Run**.
2. **Authentication > Users > Add user** : crée ton compte (coche « Auto Confirm »).
3. Dans `supabase/ajouter-admin.sql`, mets ton email, colle le script dans le SQL Editor et **Run**. Ton email doit s'afficher.
4. Dans les réglages d'authentification, désactive **Allow new users to sign up**.

Utilise un mot de passe solide et unique : celui qui contrôle ce compte contrôle les mods installés sur les PC de tes joueurs.

## 2. GitHub

1. Crée un dépôt **public** (nécessaire pour les mises à jour automatiques).
2. Envoie tout le contenu de ce dossier, le plus simple avec **GitHub Desktop**. Vérifie que le dossier `.github` est bien présent sur GitHub.
3. **Settings > Pages** : « Deploy from a branch », branche `main`, dossier `/docs`.
4. Ton site admin : `https://TON-PSEUDO.github.io/NOM-DU-DEPOT/`

## 3. Connexion Minecraft

**Aucun ID Azure ni inscription OAuth n'est nécessaire.** Chaque joueur doit installer le **launcher Minecraft officiel** et s'y connecter avec son propre compte Microsoft qui possède Minecraft Java Edition.

Ferme le launcher Minecraft officiel s'il est déjà ouvert. Quand le joueur clique sur **Jouer**, le launcher prépare Minecraft et Fabric, synchronise les fichiers, sélectionne l'installation Fabric du serveur dans le launcher officiel et l'ouvre. Le joueur se connecte dans cette application officielle, puis clique sur **Jouer**. La première ouverture peut demander au launcher officiel de télécharger des composants Java.

L'authentification reste celle de Microsoft/Minecraft ; le launcher personnalisé ne récupère ni ne stocke les identifiants. Le joueur rejoint ensuite le serveur depuis le menu Multijoueur de Minecraft. L'adresse configurée sur le site admin sert à afficher l'état du serveur, pas à connecter automatiquement le joueur.

## 4. Régler le launcher

Sur le site admin :

- **Serveur & jeu** : l'adresse IP de ton serveur, utilisée pour afficher son état.
- **Apparence** : nom, logo, couleurs, fond, police, disposition, CSS libre, avec aperçu en direct.
- **Textes & liens** : tous les textes principaux, boutons Discord, boutique, etc.
- **Mods & fichiers** : onglets Mods, Resource packs, Shaders et Configs. Glisse plusieurs fichiers d'un coup, ou coche plusieurs résultats Modrinth. Les shaders ont besoin du mod **Iris** : ajoute-le depuis l'onglet Mods.
- **Actualités** : les annonces affichées dans le launcher.

Clique sur **Enregistrer** après avoir changé des réglages. Les fichiers et actualités sont publiés tout de suite.

Côté joueur, la page **Mods & packs** permet d'ajouter ses propres resource packs et shaders (plusieurs à la fois ou par glisser-déposer). Ses mods personnels sont interdits par défaut ; pour les autoriser, décoche l'option dans **Serveur & jeu**.

## 5. Publier le .exe

1. Sur GitHub : **Settings > Developer settings > Personal access tokens > Fine-grained tokens** (dans les réglages de ton compte). Limite le jeton à ce dépôt, avec la permission **Actions : Read and write** et **Contents : Read**.
2. Site admin > **Mises à jour** : colle le jeton, mets la version `1.0.0`, clique **Publier**.
3. Après environ 5 minutes, clique **Actualiser** puis **Télécharger le .exe**. C'est ce fichier que tu donnes aux joueurs.

Sans jeton : onglet **Actions** du dépôt > « Publier le launcher » > **Run workflow**.

**Page publique** : donne à tes joueurs `https://TON-PSEUDO.github.io/NOM-DU-DEPOT/telecharger/`. Elle propose toujours la dernière version et se personnalise dans l'onglet **Page publique** du site admin.

**Pour une mise à jour**, publie un numéro plus grand (`1.0.1`). Les launchers la téléchargent seuls et l'installent au redémarrage. Pour la rendre obligatoire, indique ce numéro dans « Version minimale », une fois la compilation réussie.

Le .exe n'est pas signé : Windows peut afficher « Windows a protégé votre ordinateur » (**Informations complémentaires > Exécuter quand même**).

## Modifier le code

- Interface : `launcher/src/renderer/`
- Réglages par défaut : `docs/defaults.json`
- Après modification : `cd launcher`, `npm install`, `npm test` (met aussi à jour l'aperçu du site), `npm start` pour essayer.
- Changer de projet Supabase : `launcher/src/config.json` et `docs/config.js`.

## Limites de l'offre gratuite Supabase

50 Mo par fichier, quota de téléchargement mensuel limité, et projet mis en pause après une période sans activité. Préfère Modrinth pour les mods : les joueurs les téléchargent directement chez eux.
