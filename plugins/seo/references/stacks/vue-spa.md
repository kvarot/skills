# Stack : application Vue (SPA)

Application à page unique : `index.html` contient un conteneur vide (`<div id="app"></div>`) et le navigateur construit la page en JavaScript. Détecté par la dépendance `vue` dans `package.json` et ce conteneur vide.

## 1. Où naît le HTML

Dans le navigateur. Le HTML servi est la coquille de `index.html` ; tout le contenu vient des composants. Les sources sont des composants `.vue` ; le dossier construit (`dist`) est une sortie, jamais une source.

## 2. Où vivent title et meta

Le `<head>` de `index.html` ne porte qu'un title et une description **uniques pour tout le site**. Pour varier par page, les définir par route puis les appliquer à chaque navigation.

```js
const routes = [
  { path: '/', component: Accueil, meta: { title: 'Cabinet de kinésithérapie', description: 'Prise de rendez-vous en ligne.' } },
  { path: '/contact', component: Contact, meta: { title: 'Contact', description: 'Adresse, horaires et accès.' } },
]

router.afterEach((to) => {
  document.title = to.meta.title ?? 'Nom du cabinet'
  let m = document.querySelector('meta[name="description"]')
  if (!m) { m = document.createElement('meta'); m.name = 'description'; document.head.appendChild(m) }
  m.content = to.meta.description ?? ''
})
```

Faire de même pour le canonical et les balises Open Graph. Repérer d'abord un mécanisme existant (bibliothèque de gestion du `<head>`, plugin) et le réutiliser. Pour plusieurs langues, lire les textes dans le fichier de traduction de la locale courante et mettre à jour l'attribut `lang` de `<html>`.

## 3. Ajouter sitemap et robots

`robots.txt` et `sitemap.xml` vont dans le dossier des fichiers statiques copiés tels quels au build (`public/`). Le sitemap liste les URL de routes publiques, en absolu. Les routes dynamiques (`/service/:id`) demandent de connaître les identifiants réels : les demander plutôt que les inventer.

## 4. Relier une URL à sa source

URL, puis entrée du fichier de routes (`src/router/index.js`), puis composant de page. Vérifier le mode d'historique : avec `createWebHistory`, les URL sont propres et le serveur doit renvoyer `index.html` pour toute route ; avec `createWebHashHistory`, l'URL contient `#/…` et les robots ne voient qu'une seule page.

## 5. Pièges connus et limites

- **Robots qui n'exécutent pas le JavaScript** : certains robots, aperçus de partage (réseaux sociaux, messageries) et outils d'audit ne lisent que la coquille. Title, description et contenu par page y sont absents. Ce qu'un `afterEach` ajoute n'est vu que par ceux qui exécutent le JS, et avec délai.
- Mode `#` : une seule page pour les robots.
- Routes inconnues qui renvoient 200 avec la coquille : pas de vraies erreurs 404.
- Un audit du dossier construit ne montre que la coquille (T-SPA-HTML-VIDE).

### Pistes d'architecture, à proposer seulement

Ne rien installer ni migrer sans accord explicite. À présenter avec leur coût :

- **Pré-rendu** des routes publiques au build : HTML complet par route, serveur inchangé ; limité aux routes connues d'avance.
- **Rendu côté serveur (SSR)** : HTML complet pour chaque requête, y compris dynamique ; demande un serveur Node et une refonte du déploiement.
- **Pages publiques hors SPA** : garder la SPA pour l'espace connecté, servir le site vitrine en HTML.
