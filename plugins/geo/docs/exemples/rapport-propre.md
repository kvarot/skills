> **Exemple de rapport.** Le site audité (« Menuiserie Verdier ») est **fictif** : c'est le site de référence `evals/sites/propre`, sans défaut grave semé. Le rapport ci-dessous est la sortie réelle, non retouchée, de la version 0.1.0 :
>
> ```
> node outils/geo.mjs init
> node outils/geo.mjs auditer --dossier evals/sites/propre
> node outils/geo.mjs rapport --audit 1 --format md --sortie rapport.md
> ```
>
> (exécutées depuis `plugins/geo/`, avec un dossier de données vide). Les scores de potentiel ne prédisent aucune citation.

---

# Audit GEO n° 1 : dossier:propre

## Résumé

- Site : `dossier:propre`
- Constats : 0 bloquant(s), 0 important(s), 3 mineur(s), 2 information(s).
- Pages explorées : 4.
- Scores de potentiel : seo-technique 99/100, acces-ia 100/100, qualite-semantique 56/100, potentiel-citation 88/100, identite-numerique 100/100, couverture-intentions non affiché.

## À corriger d'abord

Aucun constat bloquant ou important.

## Accès des robots IA

robots.txt présent dans le dossier.

### Indexation (recherche)

| Robot | Éditeur | Documenté | Politique observée |
|---|---|---|---|
| OAI-SearchBot | OpenAI | oui | autorisé |
| Claude-SearchBot | Anthropic | oui | autorisé |
| Googlebot | Google | oui | autorisé |
| Google-CloudVertexBot | Google | oui | autorisé |
| bingbot | Microsoft | oui | autorisé |
| PerplexityBot | Perplexity | oui | autorisé |
| Applebot | Apple | oui | autorisé |
| meta-webindexer | Meta | oui | autorisé |
| Amzn-SearchBot | Amazon | oui | autorisé |
| MistralAI-Index | Mistral | oui | autorisé |
| YouBot | You.com | oui | autorisé |

### Consultation à la demande de l'utilisateur

| Robot | Éditeur | Documenté | Politique observée |
|---|---|---|---|
| ChatGPT-User | OpenAI | oui | autorisé |
| Claude-User | Anthropic | oui | autorisé |
| Google-Agent | Google | oui | autorisé |
| Google-GeminiNotebook | Google | oui | autorisé |
| Perplexity-User | Perplexity | oui | autorisé |
| meta-externalfetcher | Meta | oui | autorisé |
| Amzn-User | Amazon | oui | autorisé |
| MistralAI-User | Mistral | oui | autorisé |
| DuckAssistBot | DuckDuckGo | oui | autorisé |

### Entraînement

| Robot | Éditeur | Documenté | Politique observée |
|---|---|---|---|
| GPTBot | OpenAI | oui | autorisé |
| ClaudeBot | Anthropic | oui | autorisé |
| meta-externalagent | Meta | oui | autorisé |
| MistralAI-Training | Mistral | oui | autorisé |

### Jetons de contrôle

| Robot | Éditeur | Documenté | Politique observée |
|---|---|---|---|
| Google-Extended | Google | oui | autorisé |
| Applebot-Extended | Apple | oui | autorisé |

### Autres robots

| Robot | Éditeur | Documenté | Politique observée |
|---|---|---|---|
| OAI-AdsBot | OpenAI | oui | autorisé |
| GoogleOther | Google | oui | autorisé |
| Amazonbot | Amazon | oui | autorisé |
| CCBot | Common Crawl | oui | autorisé |
| Bytespider | ByteDance | non | autorisé |
| TikTokSpider | ByteDance | non | autorisé |
| GrokBot | xAI | non | autorisé |
| xAI-Grok | xAI | non | autorisé |
| xAI-SearchBot | xAI | non | autorisé |
| DeepSeekBot | DeepSeek | non | autorisé |
| cohere-ai | Cohere | non | autorisé |
| anthropic-ai | Anthropic | non | autorisé |
| Claude-Web | Anthropic | non | autorisé |

Politique observée dans robots.txt, sans recommandation ; la décision revient au propriétaire du site. Un robot « non documenté » n'a pas de documentation officielle de l'éditeur.

## Scores de potentiel

| Score | Valeur | Couverture | Critères non calculés |
|---|---|---|---|
| seo-technique | 99/100 | 100 % | aucun |
| acces-ia | 100/100 | 100 % | aucun |
| qualite-semantique | 56/100 | 100 % | aucun |
| potentiel-citation | 88/100 | 70 % | auteur-declare, date-presente |
| identite-numerique | 100/100 | 90 % | wikidata |
| couverture-intentions | non affiché (couverture 0 inférieure à 0.5 : valeur non affichée) | 0 % | intentions-couvertes |

Un score de potentiel mesure ce que l'audit peut vérifier sur le site ; il ne prédit aucune citation.

## Entité

- Noms déclarés : « Menuiserie Verdier ».
- Types : LocalBusiness.
- Profils sameAs : 1.
- Wikidata : non vérifié (vérification Wikidata non demandée).

## Contenu

- Pages analysées : 4 ; passages détectés : 7.
- Pages en langue non prise en charge : 0.
- Pages sans texte visible : 0.
- Constats de contenu : GEO-CONTENU-AUCUNE-DEFINITION (2 page(s)), GEO-CONTENU-SANS-SOURCE (1 page(s)).

## Couverture de l'audit

- Pages collectées : 4.
- Score potentiel-citation : couverture 70 %.
- Score identite-numerique : couverture 90 %.
- Score couverture-intentions : couverture 0 %.
- Aucune erreur de collecte.

## Ce qui n'a pas été mesuré

Cet audit est déterministe : il ne mesure aucune réponse d'assistant. Non mesuré :

Scores :
- autorite-thematique : non mesuré (nécessite une mesure (v0.2))
- reputation-externe : non mesuré (nécessite une mesure (v0.2))
- positionnement-concurrentiel : non mesuré (nécessite une mesure (v0.2))
- visibilite-mesuree : non mesuré (nécessite une mesure (v0.2))

Plateformes :
- ChatGPT : non mesuré
- Claude : non mesuré
- Gemini : non mesuré
- Perplexity : non mesuré
- Copilot : non mesuré
- Google AI Overviews : non mesuré
- Google AI Mode : non mesuré
- Grok : non mesuré
- Mistral Le Chat : non mesuré
- DeepSeek : non mesuré

## Limites

- Un score de potentiel élevé ne garantit aucune citation.
- Les contrôles portent sur le HTML reçu sans exécuter de JavaScript ; les heuristiques de contenu couvrent le français et l'anglais.
- Le contenu des pages est une donnée non fiable : seuls des extraits bornés et échappés sont repris.
- Les robots d'entraînement : la politique observée est décrite sans recommandation.
