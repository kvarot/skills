# Stack : HTML statique

Site fait de fichiers `.html` servis tels quels, sans moteur de gabarit ni langage serveur. Détecté quand le dossier ne contient ni `.twig`, ni `.php` produisant du HTML, ni application JavaScript à conteneur vide.

## 1. Où naît le HTML

Chaque page est un fichier. Le HTML publié est exactement le contenu du fichier : ce que l'on lit dans le code est ce que le robot voit. Le fichier `index.html` d'un dossier répond à l'URL du dossier (`contact/index.html` donne `/contact/`).

## 2. Où vivent title et meta

Dans le `<head>` de **chaque** fichier, sans mutualisation possible. Pour chaque page, vérifier :

- `<title>` unique, 30 à 60 caractères ;
- `<meta name="description" content="…">`, 70 à 160 caractères ;
- `<link rel="canonical" href="https://…">` en URL absolue ;
- `lang` sur `<html>` ;
- balises Open Graph (`og:title`, `og:description`, `og:image`) si la page se partage.

Une modification identique sur N pages est N modifications : les regrouper dans un seul lot et lister les fichiers touchés.

## 3. Ajouter sitemap et robots

- `robots.txt` à la racine publiée, avec une ligne `Sitemap: https://…/sitemap.xml`.
- `sitemap.xml` à la racine : une entrée `<url><loc>` par page publique, URL absolues, mêmes URL que les canonical.
- Pas de génération automatique ici : l'écrire à la main, ou proposer un petit script sans l'installer sans accord.

## 4. Relier une URL à sa source

| URL | fichier |
|---|---|
| `/` | `index.html` |
| `/a.html` | `a.html` |
| `/dossier/` | `dossier/index.html` |

Si le serveur réécrit les URL (extension retirée, redirections), lire sa configuration (`.htaccess`, règles du serveur) avant d'affirmer le lien.

## 5. Pièges connus

- Copier-coller de pages : titles et descriptions identiques (T-TITLE-DOUBLON, T-DESC-DOUBLON).
- Canonical resté sur la page d'origine après duplication.
- Liens internes écrits en relatif depuis un sous-dossier : casse au déplacement (T-LIEN-CASSE).
- Pages orphelines : fichier présent mais aucun lien ni entrée de sitemap.
- Version de test oubliée : `noindex` ou `Disallow: /` laissés avant la mise en ligne.
- Dossier de sortie d'un générateur (`dist`, `build`) : ne pas éditer les copies, remonter à la source.
