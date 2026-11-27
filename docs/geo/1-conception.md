# Plugin `geo` — conception

État : **validée par le mainteneur le 2026-11-27** (contrôle constructeur fait le même jour, §10). Benchmark : `docs/geo/0-benchmark.md` (le lire d'abord ; les sections citées « B§ » y renvoient).

## 1. Intention

Question à laquelle le plugin répond : **pourquoi les assistants IA (ChatGPT, Claude, Gemini, Perplexity…) recommandent-ils mes concurrents et pas moi, et comment changer cela de façon mesurable ?**

Les outils existants (B§1, B§3) font soit un audit du site noté par le modèle, soit un suivi de mentions sans statistique ni lien avec le site. Aucun ne relie, avec des preuves : état du site → réponses réellement observées → causes → corrections → nouvelle mesure comparée à des témoins.

`geo` est un **instrument de mesure et de diagnostic** :

1. audit déterministe du site (technique, accès des robots IA, entités, contenu) ;
2. scénarios de recherche réalistes, sans la marque ;
3. mesure réelle sur les moteurs par leurs **API officielles**, répétée, avec intervalles de confiance et réponses brutes conservées ;
4. comparaison avec les concurrents, cartographie des sources citées ;
5. diagnostic des causes, qualifié (prouvé / probable / hypothèse), plan d'action P0-P4 ;
6. corrections (déléguées au plugin `seo` quand il est installé) et expériences avant / après.

Public : tout développeur ou consultant qui installe le plugin, sur n'importe quel site. Rien dans le plugin ne cite un projet particulier.

## 2. Objectifs

1. Fonctionner **sans aucun service payant** pour l'audit, les scénarios, les logs et les rapports (mode gratuit).
2. Ne produire **aucun chiffre sans méthode écrite** ni **aucun résultat sans réponse brute stockée** : chaque indicateur se recalcule depuis la base.
3. Séparer partout : **potentiel théorique** (scores d'audit) ≠ **visibilité mesurée** ; **API** ≠ **interface grand public** ; **avec recherche** ≠ **sans recherche** ; **prouvé** ≠ **probable** ≠ **hypothèse**.
4. Dire « non mesuré » quand une plateforme n'est pas accessible ; ne jamais combler.
5. Coûter peu : estimation avant exécution, budget plafond, cache, reprise après interruption.
6. Langues : heuristiques au moins en **français et anglais**, structure prête pour d'autres langues.
7. Extensible : ajouter une plateforme, une langue, un secteur ou une règle = ajouter un fichier, sans toucher au moteur.

## 3. Non-objectifs

- Scraper les interfaces grand public (ChatGPT, Copilot, AI Overviews…) ou automatiser un navigateur connecté. Contraire au principe « aucun contournement des protections » et en contentieux (B§2.3). Ces surfaces sont « non mesurées », sauf import manuel de réponses ou données de première main (Search Console, Bing Webmaster « AI Performance »).
- Netlinking, achat de mentions, production de contenus en masse, faux avis.
- Corriger lui-même un site en profondeur quand `seo` est installé : il lui délègue.
- Tableau de bord hébergé, comptes, multi-utilisateur.
- Ordonnanceur intégré : le suivi récurrent passe par un ordonnanceur externe documenté (cron, Planificateur de tâches, CI) ; le plugin n'en crée aucun.

## 4. Anti-objectifs (échec même si « ça marche »)

- Un score, un pourcentage ou une citation sans preuve stockée et rejouable.
- Une réponse API présentée comme ce que voient les utilisateurs.
- Un rang (« n° 3 dans ChatGPT ») publié sans taux de présence ni intervalle (B§2.4 : le rang est instable).
- Une amélioration déclarée sur une seule réponse ou sans comparaison aux témoins.
- `llms.txt` présenté comme levier prouvé ; autoriser les robots d'entraînement sans tenir compte de la politique du propriétaire.
- Un texte collecté sur le web qui modifie le comportement du plugin (injection de prompt).
- Un journal serveur ou une clé d'API envoyé à un tiers sans accord.
- Une dépense au-delà du budget accordé.
- Un commit, un push, un déploiement, une écriture en production.
- Mentionner un projet privé dans le plugin, ses exemples, ses fixtures ou sa doc.

## 5. Contraintes

- Plugin Claude Code dans `plugins/geo/` du dépôt `kvarot/skills`, exposé par le marketplace racine (`/plugin install geo@kvarot-skills`).
- **Licence MIT** pour `plugins/geo/` seul, comme `seo` (*choix du concepteur* : même régime que le plugin voisin dont il réutilise du code) ; `LICENSE` racine et README le précisent.
- **Node ≥ 22.5**, **zéro dépendance npm** : `fetch`, `node:sqlite`, `node:test`, `node:crypto`, `node:dns` natifs. L'avertissement « SQLite is experimental » est filtré par l'outil. Sans Node : audit en lecture de code seulement, dit comme tel.
  - *Note du 2026-11-27 (revue finale de la 0.1)* : le minimum est relevé à **Node ≥ 22.13**, première version où `node:sqlite` se charge sans option `--experimental-sqlite` ; `geo.mjs` vérifie la version au lancement et refuse une version plus ancienne avec un message en français (code 1).
- Code repris de `plugins/seo/outils/` (même auteur, MIT) : **copié et adapté** dans `plugins/geo/outils/`, origine citée en tête de fichier ; les deux plugins restent installables séparément.
- Aucun code tiers copié ; idées citées dans `THIRD_PARTY_LICENSES.md` (B§5).
- Skills et documentation en **français** ; commentaires de code en **anglais** (convention du dépôt) ; contenus produits dans la langue du site audité.
- Clés d'API lues **uniquement** dans les variables d'environnement standard des éditeurs (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `PERPLEXITY_API_KEY`, `XAI_API_KEY`, `MISTRAL_API_KEY`, `DEEPSEEK_API_KEY`) ; jamais écrites, jamais journalisées, jamais dans un rapport.
- Données écrites **uniquement** sous `.claude/geo/` du dossier courant (ou `GEO_HOME`) tant qu'aucune correction n'est validée.
- Les règles du projet courant (CLAUDE.md…) priment sur le plugin.

## 6. Approches considérées

| Approche | Avantages | Inconvénients | Décision |
|---|---|---|---|
| **A. Plugin `geo` autonome, à côté de `seo`** : `geo` mesure et diagnostique, `seo` corrige dans le code | rôles nets, `seo` v1 intact, chacun installable seul | un peu de code d'extraction dupliqué | **retenue** (choix du mainteneur, 2026-11-27) |
| B. `geo` absorbe `seo` | un seul plugin | casse `seo` v1 tout juste livré, plugin énorme | écartée |
| C. `geo` dépend de `seo` installé | zéro doublon | deux installations obligatoires, couplage fragile | écartée |

Choix internes (*choix du concepteur*) :

| Question | Retenu | Écarté et pourquoi |
|---|---|---|
| Mesure des moteurs | API officielles + import manuel + proxy « recherche web de la session » étiqueté | scraping / navigateur furtif (CGU, contentieux, principe de non-contournement) |
| Extraction des mentions | déterministe d'abord (alias, domaine, frontières de mots, garde « nom-phrase », rang de liste) ; juge LLM facultatif pour l'ambiguïté et le sentiment, versionné, validé contre un jeu étiqueté | tout-LLM (non reproductible, coûteux) |
| Statistiques | intervalle de Wilson sur les taux ; test de deux proportions entre périodes ; calcul de taille d'échantillon | moyenne brute, rang moyen seul |
| Stockage | une base SQLite par dossier de travail, réponses brutes + tables dérivées reconstruisibles portant la version des règles | JSONL (requêtes historiques pénibles), PostgreSQL (dépendance) |
| Découpage en skills | 11 skills + 1 commande `/geo` + 2 agents (§7.2) | 18 skills (déclenchement confus, chevauchements) |

## 7. Architecture

### 7.1 Fichiers

```
plugins/geo/
├── .claude-plugin/plugin.json
├── README.md  SKILL.md→(skills/geo)  ARCHITECTURE.md  BENCHMARK.md→(docs/geo/0)  METHODOLOGY.md
├── SCORING.md  ROADMAP.md  SECURITY.md  PRIVACY.md  CHANGELOG.md  LICENSE  THIRD_PARTY_LICENSES.md
├── commands/geo.md                 /geo <sous-commande> [url] [options]
├── skills/                         (§7.2)
├── agents/
│   ├── lecteur-contenu.md          lecture seule, sans Bash ni écriture : juge un lot de pages collectées
│   └── juge-reponses.md            lecture seule : annote un lot de réponses (sentiment, erreurs factuelles)
├── outils/
│   ├── geo.mjs                     CLI unique, sous-commandes JSON sur stdout
│   ├── lib/  reseau.mjs (garde SSRF, débit, cache)  extraire.mjs  robots.mjs  collecter.mjs
│   │         controles.mjs  contenu.mjs  entites.mjs  scenarios.mjs  extraction.mjs
│   │         stats.mjs  scores.mjs  diagnostic.mjs  couts.mjs  base.mjs  logs.mjs  rapports.mjs
│   └── connecteurs/  openai.mjs  anthropic.mjs  gemini.mjs  perplexity.mjs  xai.mjs  mistral.mjs
│                     deepseek.mjs  manuel.mjs  session.mjs  simule.mjs  _contrat.md
├── donnees/                        versionné, daté, sourcé
│   ├── robots.json                 registre des robots (B§2.1)
│   ├── prix.json                   prix par plateforme, date et URL de la page officielle
│   ├── poids.json                  poids des scores, version
│   ├── causes.json                 catalogue des causes du diagnostic
│   ├── idees-fausses.json          affirmations à ne jamais reprendre (B§2.6)
│   ├── profils.json  intentions.json  gabarits/<langue>.json   (scénarios)
│   └── langues/<langue>.json       mots de liaison, marqueurs de définition, de chiffres, de sources
├── references/                     chargées à la demande par les skills
└── evals/  tests/ (node --test)  sites/ (sites de référence à défauts semés)  reponses/ (réponses simulées)
```

### 7.2 Skills, commande, agents

| Skill | Rôle | Sous-commandes `/geo` |
|---|---|---|
| `geo` | point d'entrée : profil du site et de la marque, choix du niveau d'audit et d'autonomie, orchestration, coût annoncé | `audit`, `quick`, `deep`, `cost` |
| `geo-technique` | indexabilité, robots IA, CDN / WAF, rendu sans JavaScript, sitemaps, canonical, hreflang, en-têtes, données structurées, `llms.txt` (informatif) | `technical` |
| `geo-contenu` | citabilité des passages, structure, définitions, chiffres, sources, auteurs, fraîcheur, lacunes face aux concurrents | `content` |
| `geo-entites` | identité de la marque : nom, variantes, ambiguïtés, Organization / Product / Service, Wikidata, profils externes, contradictions | (dans `audit`) |
| `geo-scenarios` | génère, déduplique, pondère et fige le jeu de requêtes | (dans `visibility`) |
| `geo-visibilite` | exécute les scénarios, extrait mentions et citations, calcule les indicateurs | `visibility`, `citations` |
| `geo-concurrents` | identifie les concurrents dans les réponses, audite leurs pages avec le même moteur, cartographie les sources | `competitors` |
| `geo-pourquoi` | diagnostic des causes (§7.9), plan d'action P0-P4 | `why-not` |
| `geo-correction` | applique ou délègue les corrections selon le niveau d'autonomie, vérifie | `fix`, `verify` |
| `geo-suivi` | expériences avant / après, historique, régressions, suivi récurrent par ordonnanceur externe, veille | `compare`, `history`, `monitor`, `benchmark` |
| `geo-logs` | logs Apache / Nginx / CDN : visites de robots vérifiées, pages jamais visitées, trafic référent IA | `logs` |

`geo-rapport` n'est pas un skill : `/geo report` appelle `geo.mjs rapport` (Markdown, JSON, CSV, HTML autonome). PDF : impression du HTML par le navigateur si un MCP navigateur est présent, sinon non fourni (dit).

Agents : la **lecture du contenu collecté** se fait dans `lecteur-contenu`, qui n'a ni Bash, ni écriture, ni réseau : un texte piégé n'atteint jamais un agent capable d'écrire (B§4.10). Il renvoie un JSON validé par `geo.mjs` avant usage.

### 7.3 Outils déterministes (`geo.mjs`)

Sous-commandes, toutes en JSON sur stdout, erreurs sur stderr, codes de sortie 0 (ok) / 1 (erreur) / 2 (seuil de constat dépassé) / 3 (budget ou accord manquant) :

`init`, `collecter`, `auditer`, `robots`, `entites`, `scenarios generer|figer|lister`, `estimer`, `executer`, `analyser` (ré-extraction), `indicateurs`, `scores`, `diagnostic`, `comparer`, `historique`, `logs`, `rapport`, `veille`, `base purger`.

Règle de sortie (B§1.2) : **aucun texte de page ou de réponse brut sur stdout**, seulement des faits, des identifiants et des extraits limités (280 caractères), échappés et marqués `non_fiable: true`. Le texte complet reste en base et n'est lu que par les agents en lecture seule.

### 7.4 Sécurité réseau et contenu

- Garde SSRF : schémas `http`/`https` seulement ; résolution DNS puis refus des adresses privées, de bouclage, lien-local, métadonnées cloud, sauf `--autoriser-local` (sites de test) ; vérification **à chaque redirection** (10 au plus) ; taille max 5 Mo, délai 15 s, types de contenu attendus.
- Politesse : `robots.txt` du site audité respecté pour l'agent `geo-audit` ; ≥ 1 s entre requêtes au même hôte ; agent utilisateur honnête (`geo-audit/<version> (+URL du dépôt)`) ; sondes « par agent utilisateur de robot » seulement sur accord, documentées comme non probantes (mauvaise IP).
- Tout contenu collecté = donnée non fiable : jamais exécuté, jamais suivi comme instruction ; détecteur de texte à allure d'instruction qui le signale dans les constats.
- Cache disque par URL avec expiration (24 h pages, 7 j fichiers officiels).
  - *Note du 2026-11-27 (revue finale de la 0.1)* : en 0.1, la CLI garde les réponses **en mémoire le temps d'une commande** ; chaque audit relit le site (un cache de 24 h masquait un `robots.txt` modifié entre deux audits). `exploration.depuis_cache` compte les réponses servies par ce cache. Le cache disque reste possible dans `reseau.mjs`, sans être utilisé.

### 7.5 Scénarios

- Entrées : profil (activité, offre, public, zone, langue, concurrents connus), pages du site, requêtes Search Console si fournies.
- Génération **déterministe et reproductible** (graine) : profils × intentions × gabarits par langue (`donnees/gabarits/<langue>.json`) ; enrichissement facultatif par le modèle de la session, toujours relu par l'outil (déduplication par forme normalisée et similarité de mots, quotas par intention).
- Niveaux : rapide 25, standard 100, approfondi 500, exhaustif 1 000+.
- La marque n'apparaît pas dans les requêtes de découverte ; les requêtes avec marque sont marquées et **exclues des chiffres principaux** (B§3.1, limelit).
- Le jeu est **figé** (empreinte, version) : toute comparaison exige le même jeu, ou ne porte que sur l'intersection, dit.

### 7.6 Connecteurs

Contrat unique (`connecteurs/_contrat.md`) : `estimer(requetes, options) → coût`, `executer(requete, options) → { statut: ok|echec|sans_reponse, texte, citations[], requetes_web[], recherche_effectuee: bool|inconnu, modele, version, cout, jetons, brut }`.

- **API** : OpenAI (Responses + `web_search`), Anthropic (`web_search`), Gemini (Grounding), Perplexity (Agent API), xAI, Mistral, DeepSeek. Mode `sans_recherche` et `avec_recherche` séparés. Lieu et langue passés quand l'API le permet, sinon notés « non réglable ».
- **`session`** : la recherche web de Claude Code exécutée par le skill, enregistrée comme « proxy Claude avec recherche, non représentatif de claude.ai ».
- **`manuel`** : import de réponses copiées depuis une interface grand public (Copilot, AI Overviews…), avec date et capture facultative ; seule voie pour ces surfaces.
- **`simule`** : réponses enregistrées, pour les tests.
- Ajouter une plateforme = un fichier conforme au contrat + une ligne dans `prix.json`.
- Toute surface sans connecteur utilisable = « non mesuré » dans chaque tableau.

### 7.7 Base SQLite (`.claude/geo/geo.sqlite`)

Tables principales :

- `site`, `marque` (alias, domaines), `concurrent` (alias, domaines, origine : déclaré / découvert) ;
- `jeu` (version, empreinte, langue, pays), `scenario` (profil, intention, poids, avec_marque) ;
- `campagne` (date, jeu, cible, budget, statut, reprise) ; `appel` (scénario, cible `plateforme:mode[:modèle]`, répétition, statut, coût, jetons, `recherche_effectuee`, horodatage) ; `reponse` (texte brut, JSON brut compressé, empreinte) ;
- tables **dérivées**, reconstruisibles par `analyser`, portant `version_regles` : `mention` (marque, position en caractères, rang de liste, contexte), `citation` (URL, site enregistrable, type : propre / concurrent / tiers / social / institutionnel), `annotation` (sentiment, erreur factuelle, version du juge) ;
- `audit` (date, version du moteur, constats JSON), `experience`, `log_visite` (agrégée, IP tronquée), `cout_jour`.

Purge et rétention configurables ; exports CSV / JSON de chaque table.

### 7.8 Indicateurs et statistiques

Par cible, langue, intention, profil, période ; **requêtes sans marque seulement** pour les chiffres principaux :

- taux de mention, de recommandation (mention dans une liste ou formulation de recommandation), de citation du domaine, de première recommandation ; part de voix (une marque comptée une fois par réponse) ; position moyenne seulement quand un classement existe, avec n ;
- taux de réponses contenant une erreur factuelle (contre la fiche de référence du propriétaire, §7.9) ;
- stabilité : accord entre répétitions d'une même requête.

Chaque taux porte **n et un intervalle de Wilson à 95 %** ; n < 20 → « petit échantillon ». Comparaison de périodes : test de deux proportions, verdict « significatif / non significatif / données insuffisantes ». `estimer` propose le nombre de répétitions pour une marge visée (agrégat : ~5 ; requête précise : 15-25 ; B§2.4) et rappelle qu'ajouter des requêtes vaut mieux qu'ajouter des répétitions (B§3.3).

### 7.9 Diagnostic `why-not`

Entrées : audit du site, audit des concurrents (même moteur), réponses mesurées, sources citées, logs si fournis, Search Console / Bing si fournis.

- Catalogue `donnees/causes.json` (les 16 causes demandées : blocage technique, absence d'indexation, contenu inaccessible, notoriété, sources indépendantes, couverture thématique, informations insuffisantes, différenciation, contenu difficile à citer, positionnement ambigu, concurrents mieux documentés, informations obsolètes, réputation, inadéquation d'intention, connaissances du modèle périmées, variabilité normale). Chaque cause a des **règles de preuve** déterministes (ex. « bloqué » = `robots.txt` interdit `OAI-SearchBot` + absence de citations du domaine en mode recherche OpenAI) et une **méthode de validation**.
- Qualification : **prouvé** (règle satisfaite par des preuves stockées), **probable** (indices convergents, ≥ 2 sources), **hypothèse** (à tester par une expérience proposée). Le modèle peut proposer une cause, l'outil fixe sa qualification.
- Pour chaque cause : description, preuves (identifiants d'appels, de constats), confiance, impact estimé, pages, plateformes, solution, effort, méthode de validation.
- « Pourquoi le concurrent X et pas moi » : intentions où X apparaît et pas la marque, sources citées pour X, écart d'audit X / marque sur les critères concernés. Corrélation ≠ causalité : écrit en clair dans le rapport.
- Fiche de référence facultative `.claude/geo/reference.md` (faits officiels de la marque fournis par le propriétaire) : sert à détecter les erreurs des moteurs ; sans elle, « erreurs factuelles : non évaluées ».

### 7.10 Scores

Dix scores sur 100, indépendants, méthode dans `SCORING.md`, poids dans `donnees/poids.json` (versionné ; deux exécutions de versions différentes ne se comparent pas) :

| Score | Nature |
|---|---|
| SEO technique, accessibilité aux moteurs IA | déterministes |
| couverture des intentions | déterministe (scénarios × pages qui y répondent) |
| qualité sémantique, potentiel de citation | heuristiques déterministes + avis du lecteur de contenu affiché à part |
| identité numérique | déterministe (cohérence, schema, Wikidata) + vérifications manuelles listées |
| autorité thématique, réputation externe, positionnement concurrentiel | mesurés sur les réponses et sources citées ; « non calculé » sans mesure |
| visibilité mesurée | uniquement depuis les réponses |

Règles : un critère non calculable vaut « absent », pas 0, et le score affiche son **taux de couverture** ; les critères notés par un modèle portent la classe `jugement`, leur justification et ne comptent que si le rapport l'indique ; scores de **potentiel** et score **mesuré** jamais additionnés ; aucune prétention prédictive (le rapport montre, quand il y a des concurrents mesurés, si potentiel et visibilité vont dans le même sens, sans en tirer de loi).

### 7.11 Plan d'action

P0 blocages critiques, P1 fort impact potentiel, P2 structurel, P3 complémentaire, P4 expériences. Chaque action : problème, justification, preuve, solution, fichiers ou pages, effort, impact potentiel, confiance, dépendances, risques, critères d'acceptation, vérification ; catégorie **code / éditorial / marketing / externe** ; gain rapide ou long terme. Les leviers issus de la recherche (citations, chiffres, sources dans le texte) sont en P4 « à tester » tant qu'aucune expérience du site ne les confirme (B§2.4).

### 7.12 Autonomie et corrections

Niveaux : 1 analyse ; 2 analyse + recommandations (**défaut**) ; 3 correctifs proposés en diff ; 4 application des correctifs autorisés + vérification. Niveau choisi par l'utilisateur à chaque session, jamais déduit.

- Si `seo` est installé : `geo-correction` lui confie les lots techniques et éditoriaux (son flux de validation par lot s'applique).
- Sinon : corrections limitées et réversibles (`robots.txt` sur demande explicite seulement, JSON-LD Organization / Product / Service sans valeur inventée, balises, sitemap), diff montré, écrit après accord.
- Jamais de déploiement, commit ou push.

### 7.13 Expériences

Une expérience = hypothèse, action, pages traitées et **pages témoins**, scénarios traités et **scénarios témoins**, mesure de base, date de mise en ligne vérifiée (le changement est-il servi et indexable ?), délai d'observation, mesures après, verdict par test de deux proportions avec différence de différences contre les témoins. Verdict « efficace » interdit sur une seule réponse, sans témoins, ou si la version du modèle a changé entre base et mesure (alors « inconclusif : modèle changé »).

### 7.14 Logs

Parseurs Apache / Nginx (format combiné), JSON Cloudflare / CloudFront / Fastly. Identification en trois niveaux stockés séparément (B§3.1, GEOInflow) : agent utilisateur déclaré, IP dans les plages officielles (`robots.json` → fichiers JSON des éditeurs, mis en cache), DNS inverse puis direct quand l'éditeur le documente. Sorties : visites par robot, pages, codes HTTP, temps de réponse, évolution, pages du sitemap jamais visitées, visites humaines venant d'un référent IA (`chatgpt.com`, `perplexity.ai`…). IP tronquées, aucune donnée brute envoyée ailleurs. Un log prouve l'accès, pas la citation.

### 7.15 Coûts

`estimer` avant toute campagne payante : nombre d'appels × prix de `prix.json` (daté, sourcé ; prix inconnu = campagne refusée sauf `--prix-inconnu-accepte`). Budget plafond par campagne (défaut 2 USD, *choix du concepteur*) vérifié avant chaque appel ; tentatives comptées ; concurrence limitée par plateforme ; reprise d'une campagne interrompue sans refaire les appels réussis ; cache des réponses identiques désactivé par défaut pour la mesure (on veut la variabilité), activé pour les ré-analyses.

### 7.16 Suivi et veille

- `historique` : séries 7 / 30 / 90 / 365 jours ; régression = baisse significative (§7.8) ou nouveau constat bloquant.
- `monitor` : écrit la commande prête à mettre dans l'ordonnanceur de l'utilisateur ; ne crée rien.
- `veille` : relit les sources officielles listées dans `robots.json` et `prix.json`, montre les écarts (robot ajouté, plage IP, prix) et propose un diff ; **aucune modification automatique** du registre, des poids ou des causes ; une nouvelle règle passe par tests + entrée `CHANGELOG.md`.

## 8. Évaluation

- `node --test plugins/geo/evals/tests` : extraction, contrôles, robots, statistiques (valeurs de référence), scores (couverture), diagnostic (règles de preuve), coûts (plafond), base (reprise), logs (vérification IP), sécurité (SSRF, redirections, injection), reproductibilité (même graine → même jeu), données manquantes.
- **Sites de référence** servis par un petit serveur local de test : SPA sans rendu serveur, site bloquant les robots de recherche IA, site multilingue hreflang cassé, site sans entité claire, site propre (faux positifs), page piégée par injection de prompt.
- **Réponses simulées** : jeu de réponses étiquetées à la main (mentions, citations, recommandations), en français et en anglais, avec pièges (homonymes, négations, « nom-phrase ») : précision et rappel de l'extraction mesurés et versionnés ; idem pour le juge LLM facultatif (accord, kappa).
- **Déclenchement** des skills (`claude -p`, sur le modèle de `seo`).
- **Comparaison** avec les meilleurs outils libres du benchmark sur les mêmes sites de référence, quand ils s'installent sans service payant (faux positifs, faux négatifs).
- Revue indépendante (agent relecteur sans accès à cette conception) avant chaque version poussée ; contrôle de confidentialité (noms interdits) avant chaque push.

## 9. Livraison par versions

*Choix du concepteur* — chaque version est utilisable seule, testée, relue, poussée :

| Version | Contenu | Phases de la demande |
|---|---|---|
| **0.1** | socle, sécurité réseau, collecte, audit technique + robots IA + registre, entités et données structurées, contenu (FR / EN), scénarios, base, rapports Markdown / JSON, scores de potentiel, mode gratuit complet | 0-4, 11 partiel |
| **0.2** | connecteurs API + `session` + `manuel` + `simule`, extraction, statistiques, coûts, visibilité, citations, concurrents | 5-6 |
| **0.3** | diagnostic `why-not`, scores complets, plan d'action, correction et délégation à `seo`, expériences, historique, logs, CSV / HTML, veille | 7-10 |
| **0.4** | sécurité et performances renforcées, documentation complète, scripts d'installation Windows / Linux / macOS, comparaison aux outils libres | 11-12 |

## 10. Points tranchés après le contrôle constructeur

*Choix du concepteur*, sauf mention :

1. **Passage à `seo`.** `seo` reste inchangé dans son fonctionnement. `geo-correction` écrit `.claude/geo/a-corriger.md` (constats, preuves, pages) puis appelle le skill `seo` en lui passant ce fichier comme contexte ; `seo` refait son audit et applique son flux de validation. Les constats sans équivalent dans `seo` (robots IA par agent, JSON-LD Organization / Product / Service, `llms.txt`, lacunes de citabilité) sont traités par `geo-correction` lui-même. `geo` n'écrit jamais dans `.claude/seo/`.
2. **Découverte des concurrents.** Candidats extraits de façon déterministe (noms en tête d'élément de liste, noms liés à un domaine cité, mots à majuscule répétés dans plusieurs réponses), puis triés par le modèle de la session, puis **confirmés par l'utilisateur**. Une fois confirmés, ils deviennent des alias déterministes : toute ré-analyse est rejouable. Liste non confirmée = « concurrents découverts, à confirmer », hors chiffres principaux.
3. **Juge LLM.** Par défaut, l'agent `juge-reponses` de la session : annotations de classe `jugement`, modèle noté tel que la session le déclare, **hors chiffres principaux** et hors score de réputation déterministe. En option, un juge API identifié (`--juge openai:<modèle>`), dans le budget, version stockée ; seul celui-ci peut être validé par kappa sur le jeu étiqueté.
4. **Isolation du lecteur de contenu.** `geo.mjs` exporte les textes à juger dans `.claude/geo/tmp/<lot>/`, lus par `lecteur-contenu` ; la session principale ne reçoit que le JSON renvoyé, validé par schéma. Limite **assumée et documentée** dans `SECURITY.md` : la session principale peut techniquement lire ces fichiers ; le skill le lui interdit et les tests d'injection vérifient que ses réponses ne suivent pas les instructions piégées. Le dossier est vidé après usage.
5. **Accès réseau** (décision du mainteneur, 2026-11-27). Au début de chaque audit, `geo` liste les hôtes qu'il va lire (site audité + concurrents nommés) ; **un accord pour la session** les couvre tous (`--hotes-autorises a.fr,b.com`, mémorisé pour la session dans `.claude/geo/session.json`, effacé au démarrage d'une nouvelle). Tout hôte hors liste demande un nouvel accord ; sans accord, code de sortie 3. Lecture polie (§7.4), aucune écriture distante. Le code local est lu aussi quand le dossier courant est le dépôt du site (pour relier un constat à son fichier, en correction) ; le détecteur de stack de `seo` est copié pour cela.
6. **Description de `seo`** (décision du mainteneur, 2026-11-27). La mention « or GEO, AI answer engines » est retirée de la description de `plugins/seo/skills/seo/SKILL.md` ; les demandes de visibilité dans les IA y sont renvoyées vers `geo`. Évaluations de déclenchement de `seo` relancées ; celles de `geo` couvrent le cas « deux plugins installés ».
7. **Mode gratuit.** = aucun appel facturable : audit, scénarios, logs, rapports, imports `manuel`, proxy `session`. Tout appel à une API externe, même couvert par un quota gratuit, passe par `estimer` et demande l'accord ; un quota gratuit s'affiche « 0 USD estimé (quota gratuit, non garanti) ». Les connecteurs `session` et `manuel` arrivent en 0.2 avec la mesure.

8. **Point d'entrée unique** (décision du mainteneur, 2026-11-27, appliquée en 0.1). Il n'y a **pas** de dossier `commands/` ni de fichier `commands/geo.md` : le skill `geo` est le seul point d'entrée et interprète lui-même `/geo <sous-commande> [url]`. Les mentions de `commands/geo.md` en §7.1 et de la colonne « Sous-commandes `/geo` » en §7.2 décrivent la conception d'origine ; le skill `geo` porte la table des sous-commandes (disponibles en 0.1, prévues en 0.2 ou 0.3).

## 11. Laissé au constructeur

- Noms exacts des colonnes et index SQLite, découpage interne des modules.
- Formulation des gabarits de requêtes et liste des mots par langue (dans les limites de §7.5).
- Contenu des sites de référence, tant que chaque défaut semé figure dans un fichier de vérité.
- Format visuel du rapport HTML (autonome, sans dépendance externe, lisible en clair et sombre).
