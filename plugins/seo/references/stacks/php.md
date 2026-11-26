# Stack : PHP sans framework

Pages `.php` qui émettent du HTML directement ou en incluant un fichier d'en-tête. Détecté quand un `.php` contient `<html` ou `<head`, ou en inclut un qui en contient (et qu'aucun `.twig` n'est présent).

## 1. Où naît le HTML

Le HTML est produit à l'exécution. Deux schémas fréquents :

- **En-tête partagé** : chaque page fait `include`/`require` d'un fichier (`entete.php`, `header.php`) qui ouvre `<html>` et `<head>`, puis d'un pied de page qui les ferme.
- **Pages autonomes** : chaque fichier porte son propre `<head>`.

Lire le code ne suffit pas toujours : le résultat dépend des variables et des conditions. Quand c'est possible, comparer avec le HTML réellement servi.

## 2. Où vivent title et meta

Dans l'en-tête partagé s'il existe, sinon dans chaque page. Avec un en-tête partagé, le `<title>` est un point d'entrée unique : il lit une variable posée **avant** l'`include`.

```php
<?php
$titre = 'Prise de rendez-vous';
$description = 'Réservez votre consultation en ligne.';
include __DIR__ . '/inc/entete.php';
```

**D'abord chercher un helper existant** (fonction qui produit title et meta, tableau de métadonnées par route), par exemple en cherchant `function` dans les fichiers inclus. Un helper défini mais jamais appelé est un suspect classique du title en doublon. S'il existe, **l'appeler** dans l'en-tête (`<?= nom_du_helper($titre, $description) ?>`) à la place des balises écrites à la main, sans en écrire un second.

Sans helper : dans l'en-tête, `<title><?= htmlspecialchars($titre ?? 'Titre par défaut') ?></title>`, et de même pour la description et le canonical. Toujours échapper la valeur et prévoir une valeur de repli, sinon une page oubliée sort sans title.

## 3. Ajouter sitemap et robots

- `robots.txt` statique à la racine publique, ou page PHP réécrite vers `/robots.txt`.
- `sitemap.xml` : fichier statique si les pages sont peu nombreuses, sinon script PHP qui liste les pages et émet `Content-Type: application/xml`. Ne pas y mettre d'URL privées ni de pages paginées sans intérêt.

## 4. Relier une URL à sa source

Selon le serveur : fichier direct (`/contact.php`), ou routeur unique (`index.php` qui lit l'URL) avec réécriture. Lire `.htaccess` ou la configuration du serveur, puis la table de routes. Une URL propre (`/contact`) peut venir d'un fichier ou d'une valeur de paramètre : ne pas deviner, retrouver la règle de réécriture.

## 5. Pièges connus

- Variable posée **après** l'`include` : le `<title>` sort vide ou par défaut.
- Même title sur toutes les pages parce que l'en-tête ne reçoit rien.
- Sortie avant `header()` ou une redirection : erreur, ou HTML tronqué.
- Paramètres d'URL (`?page=2`, filtres) qui génèrent des doublons : canonical vers la version de référence.
- Pages d'administration ou de test accessibles sans `noindex`.
- Contenu venant d'une base : le title dépend des données, vérifier plusieurs enregistrements.
- Fichiers `.php` sans HTML (bibliothèques, traitements) : hors du périmètre SEO.
