# Plugin `geo` — benchmark (phase 0)

Relevé du 2026-11-27. Code lu par `gh api` (aucun dépôt cloné ni exécuté) : le fonctionnement réel (tests qui passent, scripts qui tournent) **n'est pas vérifié**. Les faits sur les plateformes viennent des documentations officielles ; chaque fait porte sa classe : **OFFICIEL**, **ÉVALUÉ PAR LES PAIRS**, **PRÉPUBLICATION**, **EMPIRIQUE** (mesure par un tiers), **MARKETING**, ou « non vérifié ».

## 1. Dépôts de la liste initiale

Les 7 dépôts existent et ne sont pas vides.

### 1.1 `zubair-trabzada/geo-seo-claude` — 11 883 étoiles, MIT

- Un routeur, 15 sous-skills, 5 sous-agents ; Python, 9 dépendances (requests, bs4, lxml, playwright, Pillow, flask, rich…) ; installé par `install.sh`, pas par manifeste de plugin. Historique en JSON / Markdown sous `~/.geo-prospects/`.
- Code réel : un scoreur de « citabilité » par expressions régulières (`scripts/citability_scorer.py`), la collecte de pages, `robots.txt`, `llms.txt`, sitemap, avec détection d'un `robots.txt` géré par Cloudflare (`scripts/fetch_page.py`), un générateur de `llms.txt`.
- `scripts/brand_scanner.py` : seuls Wikipédia et Wikidata sont interrogés ; YouTube, Reddit et LinkedIn renvoient des valeurs en dur.
- Score composite (citabilité 25, marque 20, E-E-A-T 20, technique 15, schema 10, plateformes 10) : seule la citabilité est calculée par du code, les cinq autres notes sont données par le modèle. Les poids de citabilité diffèrent entre le code et le prompt.
- Aucune interrogation de plateforme IA.
- Faiblesses : chiffres non prouvés écrits en dur (« 134-167 mots optimal », « corrélation YouTube 0,737 », « +30-115 % de visibilité ») ; `llms.txt` absent classé sévérité haute ; « projection de ROI » et tarifs générés à partir des scores ; heuristiques en anglais seulement ; aucune consigne contre l'injection de prompt alors que les pages collectées vont à des sous-agents qui ont Bash et Write ; agent utilisateur Chrome usurpé ; pas de garde SSRF vue. Deux fichiers de tests, pas de CI qui les lance.
- Idées reprises : détection du `robots.txt` réécrit par le CDN ; vérification d'entité par l'API Wikidata ; rapport d'écart base / mesure courante ; type d'activité qui change l'ordre des constats.

### 1.2 `seo-skills/geo-audit-skill` (SEOmator) — 43 étoiles, MIT

- Plugin Claude + paquet pip `seomator-geo-audit` : commandes `audit, score, crawl, fetch, scan, compare, llmstxt, validate, report, prune, doctor`. Trois dépendances (requests, bs4, jinja2), Playwright facultatif. Constantes dans `src/geo_audit/data/*.json`. Historique JSONL en ajout seul, pages stockées par empreinte (`~/.geo`).
- Score déterministe : `composite = round(somme(acquis) / somme(max des signaux calculés) × 100)`. Un signal non calculable vaut `None`, pas 0, et apparaît comme taux de couverture (`scoring/model.py`). Chaque signal est classé `deterministic`, `heuristic`, `live` ; les grilles notées par un modèle (« advisory ») sont exclues du score par construction.
- Preuve : SHA-256 des blocs extraits + `normalizer_version`, marquée CURRENT / PARTIAL / STALE ; `compare` refuse deux exécutions de versions de score différentes. La doc écrit que le score « n'est pas une prédiction de la part de citation ».
- Mesure IA facultative : ChatGPT, Gemini, Google AI Mode par le scraper payant scrape.do (jeton de l'utilisateur), deux questions par moteur, **un seul échantillon** ; résultats hors score.
- Le plus solide : ~65 fichiers de tests, fichiers de référence, serveur de fixtures, tests d'injection et de frontière de sortie, CI sur trois systèmes. Aucune activité depuis le 2026-09-29.
- Faiblesses : dépendance à un scraper payant des interfaces grand public (risque CGU, format non documenté, US / anglais) ; poids hérités du dépôt 1.1 ; `llms.txt` encore noté.
- Idées reprises : `None` au lieu de 0 + couverture ; classes de signaux ; constantes versionnées et refus de comparer entre versions ; preuve par empreinte de bloc ; frontière de sortie (aucun texte de page dans la sortie de l'outil, extraits limités et échappés) ; détecteur de texte à allure d'instruction ; garde SSRF avant et après connexion ; marque retirée de la question de catégorie.

### 1.3 `thevibegarage/geo-visibility-skill` — 2 étoiles, MIT

- Python bibliothèque standard seule. `check_ai_readiness.py` : correspondance `robots.txt` RFC 9309, sondes WAF par agent utilisateur de robot, comparaison du rendu selon l'agent (mots, title, H1, JSON-LD pour navigateur, robot, Googlebot, Bingbot), soft 404 par agent, honnêteté des `lastmod`, contrôles de snippet, IndexNow.
- `score_tracker.py` calcule taux de mention, de citation, position moyenne, part de voix, exactitude, sentiment depuis un CSV ; répétitions réduites par vote majoritaire ; exécutions avec et sans recherche jamais mélangées ; `--compare` avertit si le jeu de requêtes diffère.
- Mesure : **pas dans le code**. Les requêtes (25-50, six étapes du parcours) sont jouées par la recherche web de Claude, un navigateur, ou collées par l'utilisateur.
- 13 fichiers de tests, dont un test AST qui interdit subprocess / eval / réseau hors du vérificateur ; CI Python 3.8 et 3.12.
- Idées reprises : schéma du CSV de suivi (`prompt_id, stage, prompt, engine, mode, run, mentioned, cited, position, sentiment, accurate, competitors, cited_domains`) ; séparation avec / sans recherche ; jeu de requêtes figé avec quotas par étape ; liste classée des domaines cités comme cibles hors site ; deux sources pour conclure à un échec de collecte ; page traitée / page témoin ; comparaison de rendu par agent ; tableau « à corriger d'abord » en tête de rapport.

### 1.4 `rankxai/seo-geo-skills` — 1 étoile, MIT (avec `NOTICE` pour des parties adaptées)

- Six CLI Node sans dépendance : `audit-page`, `crawl-site`, `check-crawlers` (robots + sondes par agent), `check-sitemap`, `analyze-gsc` (exports Search Console hors ligne), `check-logs` (visites de robots vérifiées par plages IP). Registres `data/crawlers.json`, `data/myths.json`, `data/google-changes.json`, `data/ai-platform-changes.json`.
- Pas de score : constats ERROR / WARN / INFO, ERROR réservé aux pages mesurablement cassées. Chaque règle porte un niveau de preuve ([G] doc Google, [S] étude, [P] article, [M] éditeur…).
- Aucune interrogation de plateforme ; `references/measurement.md` décrit les sources de première main et un panel de 50-200 questions à construire à la main.
- ~25 fichiers `node --test`, CI Node 18 / 22 / 24. Un seul commit (2026-09-30).
- Idées reprises : format du registre de robots (jeton, agent complet, rôle — entraînement / recherche / consultation utilisateur / jeton de contrôle —, respect de `robots.txt`, citation de l'éditeur, URL des plages IP, URL de doc, `last_verified`) ; registre des idées fausses (motif, raison, source, date) ; journal daté des changements de plateformes ; logs avec vérification IP ; niveau de preuve par règle ; requêtes avec / sans marque séparées ; codes de sortie 0 / 1 / 2 / 3 ; caractères invisibles.

### 1.5 `Didgeheads/geo-skill` — 4 étoiles, sans licence

Un seul prompt de 4,7 Ko et une page d'accueil. Note donnée par le modèle, statistiques non sourcées présentées comme faits (« +40 % », « 23× conversion »). Sans licence : idées seulement ; rien de technique à reprendre.

### 1.6 `rampstackco/claude-skills` — 1 128 étoiles, MIT

Catalogue d'environ 120 skills Markdown ; le GEO tient en un skill (`skills/seo-aeo-geo/SKILL.md`), sans code exécutable. Conseils seulement, notes données par le modèle. Idée reprise : « une donnée indisponible dite comme telle est une réponse complète ; ne jamais fabriquer un nombre ».

### 1.7 `aelena/seo-geo-audit` — 0 étoile, sans licence

Audit du code source du front (« ne pas récupérer le site en ligne »), quatre scripts bash de découverte, constats jugés par le modèle, score par déductions (haute −8, moyenne −3, basse −1, plafond −16 par contrôle) qualifié par l'auteur de « vibe check ». Sans licence : idées seulement — citations `fichier:ligne`, identifiants de contrôle stables, plafond de déduction par contrôle, mode correction avec confirmation par modification et sans toucher aux fichiers de politique (`robots.txt`, `llms.txt`) sans demande explicite, refus de laisser un `{{PLACEHOLDER}}` dans le JSON-LD inséré.

### 1.8 Matrice

| Dépôt | Étoiles | Dernier commit | Licence | Moteur déterministe | Mesure IA réelle | Concurrents | Historique | Tests | Correction | Faiblesse principale |
|---|---|---|---|---|---|---|---|---|---|---|
| zubair-trabzada/geo-seo-claude | 11 883 | 2026-10-05 | MIT | partiel (citabilité) | non | non | JSON / MD | 2, sans CI | non | 5 notes sur 6 données par le modèle ; chiffres non prouvés |
| seo-skills/geo-audit-skill | 43 | 2026-09-29 | MIT | oui | facultative, scraper payant, 1 échantillon, hors score | partiel | JSONL + pages | ~65, CI | non | scraper payant des interfaces grand public ; inactif |
| thevibegarage/geo-visibility-skill | 2 | 2026-10-27 | MIT | oui | non (saisie manuelle / recherche Claude) | part de voix (CSV) | CSV | 13, CI | prompt seulement | mesures saisies à la main ou par le modèle |
| rankxai/seo-geo-skills | 1 | 2026-09-30 | MIT | oui (constats, pas de score) | non | non | non | ~25, CI | non | un commit ; registres qui vieillissent |
| Didgeheads/geo-skill | 4 | 2026-04-15 | aucune | non | non | non | non | non | non | prompt de chiffres non sourcés |
| rampstackco/claude-skills | 1 128 | 2026-11-16 | MIT | non | non | prompt | non | lint | non | conseils seulement |
| aelena/seo-geo-audit | 0 | 2026-08-16 | aucune | non | non | non | non | non | prompt, avec confirmation | score jugé par le modèle ; site en ligne jamais vérifié |

### 1.9 Ce qu'aucun ne fait

- Mesure par les **API officielles** (OpenAI, Anthropic, Gemini, Perplexity avec recherche web) ; aucun ne couvre Perplexity, Claude ou Copilot par du code.
- **Échantillonnage répété** avec intervalle de confiance.
- **Réponses brutes conservées** (texte, citations, modèle, date, langue, lieu) comme preuve rejouable.
- **Scores validés** : aucun ne montre que son score de préparation ou de citabilité suit les citations observées. Trois dépôts partagent la même grille non validée.
- **Jeu de requêtes** construit à partir de la demande réelle (Search Console, requêtes Bing) puis figé et joué.
- **Concurrents** audités avec le même moteur que le site, à côté de leur part de voix mesurée.
- **Données de première main** : rapport « AI Performance » de Bing Webmaster, rapports IA de Search Console.
- **Boucle fermée** : constat → correction dans le dépôt → nouvelle mesure → comparaison à des témoins.
- **Langues autres que l'anglais** dans les heuristiques.
- **Isolation du contenu collecté** de l'agent qui a les outils d'écriture.
- **Registre de robots** tenu à jour depuis les sources officielles (plages IP, docs).

## 2. Faits officiels sur les plateformes

### 2.1 Registre des robots

Rôles : **entraînement**, **indexation** (recherche), **consultation déclenchée par un utilisateur**, **jeton de contrôle** (ne visite pas, ne fait que porter une règle).

| Éditeur | Jeton | Rôle | `robots.txt` selon l'éditeur | Vérification d'identité | Source |
|---|---|---|---|---|---|
| OpenAI | `GPTBot` | entraînement | respecté | `https://openai.com/gptbot.json` | https://developers.openai.com/api/docs/bots |
| OpenAI | `OAI-SearchBot` | indexation (ChatGPT search) | respecté ; bloqué = absent des réponses de ChatGPT search | `https://openai.com/searchbot.json` | idem |
| OpenAI | `ChatGPT-User` | consultation utilisateur | « peut ne pas s'appliquer » | `https://openai.com/chatgpt-user.json` | idem |
| OpenAI | `OAI-AdsBot` | autre (pages d'annonces) | non précisé | `https://openai.com/adsbot.json` | idem |
| Anthropic | `ClaudeBot` | entraînement | respecté, `Crawl-delay` pris en charge | `https://claude.com/crawling/bots.json` (plages non attribuées par robot) | https://support.claude.com/en/articles/8896518 |
| Anthropic | `Claude-SearchBot` | indexation | respecté | idem | idem |
| Anthropic | `Claude-User` | consultation utilisateur | respecté (déclaration générale) | idem | idem |
| Google | `Googlebot` | indexation ; contrôle aussi AI Overviews et AI Mode | respecté | DNS inverse `crawl-*.googlebot.com` ; `common-crawlers.json` | https://developers.google.com/crawling/docs/crawlers-fetchers/verify-google-requests |
| Google | `Google-Extended` | jeton de contrôle : entraînement et ancrage Gemini / Vertex ; **sans effet sur Search** | — | — | https://developers.google.com/crawling/docs/crawlers-fetchers/google-common-crawlers |
| Google | `GoogleOther` | autre (recherche interne) | respecté | `common-crawlers.json` | idem |
| Google | `Google-CloudVertexBot` | indexation demandée par le propriétaire (Vertex AI Agents) | respecté | `special-crawlers.json` | idem |
| Google | `Google-Agent` | consultation utilisateur (agent) | « ignore généralement » | `user-triggered-agents.json` | https://developers.google.com/crawling/docs/crawlers-fetchers/google-agent |
| Google | `Google-GeminiNotebook` (ex-`Google-NotebookLM`, ancien nom accepté jusqu'en août 2026) | consultation utilisateur | ignore généralement | `user-triggered-fetchers-google.json` | https://developers.google.com/search/docs/crawling-indexing/google-user-triggered-fetchers |
| Microsoft | `bingbot` | indexation ; Copilot s'appuie sur l'index Bing (non vérifié officiellement) | respecté | `https://www.bing.com/toolbox/bingbot.json` (daté 2024-01-03) ; DNS inverse `*.search.msn.com` (de mémoire, non vérifié) | pages d'aide Bing non lisibles (rendues en JavaScript) |
| Perplexity | `PerplexityBot` | indexation, pas d'entraînement | respecté | `https://www.perplexity.ai/perplexitybot.json` | https://docs.perplexity.ai/guides/bots |
| Perplexity | `Perplexity-User` | consultation utilisateur | « ignore généralement » | `https://www.perplexity.ai/perplexity-user.json` | idem |
| Apple | `Applebot` | indexation ; peut servir à l'entraînement | respecté ; repli sur les règles Googlebot | DNS inverse `*.applebot.apple.com` ; `https://search.developer.apple.com/applebot.json` | https://support.apple.com/en-us/119829 |
| Apple | `Applebot-Extended` | jeton de contrôle (entraînement) | — | — | idem |
| Meta | `meta-externalagent` | entraînement / indexation | bloquable | pas de fichier IP dédié (ASN 32934, à revérifier) | https://developers.facebook.com/docs/sharing/webmasters/web-crawlers/ |
| Meta | `meta-webindexer` | indexation Meta AI | bloquable | idem | idem |
| Meta | `meta-externalfetcher` | consultation utilisateur | « peut contourner » | idem | idem |
| Amazon | `Amazonbot` | amélioration produit ; peut entraîner | respecté | liste IP publiée | https://developer.amazon.com/amazonbot |
| Amazon | `Amzn-SearchBot` | indexation | respecté | liste IP publiée | idem |
| Amazon | `Amzn-User` | consultation utilisateur | « peut ne pas suivre » | liste IP publiée | idem |
| Common Crawl | `CCBot` | corpus ouvert (très réutilisé pour l'entraînement) | respecté | DNS inverse `crawl.commoncrawl.org` ; `https://index.commoncrawl.org/ccbot.json` | https://commoncrawl.org/ccbot |
| Mistral | `MistralAI-User` | consultation utilisateur | régit les sites demandés | `https://mistral.ai/mistralai-user-ips.json` | https://docs.mistral.ai/robots |
| Mistral | `MistralAI-Index` | indexation | respecté | `https://mistral.ai/mistralai-index-ips.json` | idem |
| Mistral | `MistralAI-Training` | entraînement | bloquable | aucune | idem |
| DuckDuckGo | `DuckAssistBot` | consultation pour réponses IA, pas d'entraînement | respecté (~3 jours) | `https://duckduckgo.com/duckassistbot.json` | https://duckduckgo.com/duckduckgo-help-pages/results/duckassistbot |
| You.com | `YouBot` | indexation | respecté, `Crawl-delay` compris | `68.67.112.0/24`, DNS `youbot-*.search.you.com`, Web Bot Auth | https://you.com/docs/youbot |
| Cohere | — | déclare ne pas explorer le web | — | — | https://docs.cohere.com/docs/cohere-web-crawlers |

**Non documentés par l'éditeur** (tiers seulement) : `Bytespider`, `TikTokSpider`, `GrokBot`, `xAI-Grok`, `xAI-SearchBot`, `DeepSeekBot`, `cohere-ai`, `anthropic-ai`, `Claude-Web`. Le registre les garde avec `documente: false` et ne les présente jamais comme officiels.

À venir : Google annonce la prise en charge du signal AIPREF (`user-agent: __usage_ai-training`) début 2027 ; pas actif.

### 2.2 `llms.txt`

- Proposition communautaire (llmstxt.org, 2024, révisée en 2026), ni IETF ni W3C ; `llms-full.txt` n'y figure pas.
- **OFFICIEL** Google : Search ne l'utilise pas ; le maintenir « n'aide ni ne nuit » (https://developers.google.com/search/docs/fundamentals/ai-optimization-guide).
- Aucun autre éditeur n'a déclaré l'utiliser.
- **EMPIRIQUE** Ahrefs, mai 2026 (https://ahrefs.com/blog/llmstxt-study/) : sur ~38 000 domaines ayant un fichier valide, 97 % n'ont reçu aucune requête pour ce fichier en un mois.

Conséquence : constat informatif, **poids nul** dans tout score.

### 2.3 Accès programmatique aux moteurs

| Moteur | API officielle avec recherche | Citations | Lieu / langue | Prix indicatif | API ≠ interface grand public |
|---|---|---|---|---|---|
| OpenAI | Responses API, outil `web_search` | annotations `url_citation` ; `sources` | `user_location` | 10 $ / 1 000 appels + jetons | aucune déclaration |
| Anthropic | Messages API, outil `web_search` | toujours présentes, `cited_text` | `user_location` | 10 $ / 1 000 recherches + jetons | aucune déclaration |
| Google Gemini | Grounding with Google Search | `groundingMetadata` / `url_citation` | non documenté | 14 $ / 1 000 requêtes (Gemini 3), 5 000 gratuites / mois | aucune ; **ce n'est pas AI Overviews** |
| Perplexity | Agent API, outil `web_search` (Sonar Chat Completions arrêté le 2026-09-27) | `search_results` + `[n]` | non confirmé | 2,50 $ / 1 000 appels + jetons | **OFFICIEL : les sorties peuvent différer, le modèle aussi** |
| xAI | outils `web_search`, `x_search` | URL sources | `user_location` | 5 $ / 1 000 appels | aucune |
| Mistral | Conversations / Agents API, `web_search` | `tool_reference` | non documenté | non vérifié | aucune |
| DeepSeek | `deepseek_web_search` | oui | refusé | outils non facturés, jetons seuls | aucune |
| Copilot grand public | aucune API publique | — | — | — | — |
| AI Overviews / AI Mode | aucune API officielle | — | — | — | — |

Sources : https://developers.openai.com/api/docs/guides/tools-web-search, https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool, https://aistudio.google.com/docs/google-search, https://docs.perplexity.ai/docs/resources/faq.md, https://docs.x.ai/docs/guides/tools/search-tools, https://docs.mistral.ai/agents/tools/built-in/websearch, https://api-docs.deepseek.com/guides/web_tools.

- Les API de recherche Bing ont été retirées le 2025-08-11 ; « Grounding with Bing Search » (Azure) ancre **votre** agent, pas la réponse de Copilot.
- Sources de première main : Bing Webmaster Tools « AI Performance » (préversion publique 2026-02-10 : citations dans Copilot et les résumés IA de Bing, requêtes échantillonnées, site vérifié seulement) ; Search Console (rapport de performance IA selon le guide Google).
- AI Overviews / AI Mode par scraping (DataForSEO, SerpApi…) : contentieux en cours (Google contre SerpApi, depuis décembre 2025). Le plugin **ne scrape aucune interface** ; un connecteur de ce type reste hors moteur, facultatif, avec avertissement CGU.
- **EMPIRIQUE** : 23 % des appels API OpenAI sans recherche déclenchée (Surfer) ; 57,8 % des répétitions ChatGPT sans recherche (Schulte et al. 2026, cité par la revue ci-dessous). Chaque appel doit enregistrer **si une recherche a eu lieu**.

### 2.4 Recherche sur le GEO

- **ÉVALUÉ PAR LES PAIRS** Aggarwal et al., « GEO », KDD 2024 (https://arxiv.org/abs/2311.09735) : moteur simulé (gpt-3.5-turbo, 5 documents fixés) ; citations ajoutées ≈ +41 %, statistiques ≈ +31 %, bourrage de mots-clés ≈ −8 % sur une métrique de part de texte ; gains à somme nulle entre sources ; test Perplexity sur 200 cas avec sources téléversées.
- **ÉVALUÉ PAR LES PAIRS** C-SEO Bench, NeurIPS D&B 2025 (https://arxiv.org/abs/2506.11097) : méthodes de réécriture « largement inefficaces », 3 combinaisons significatives sur 54 ; le rang de récupération pèse bien plus ; les gains fondent quand tout le monde les adopte. De fait, une non-réplication.
- **PRÉPUBLICATION** Martinez, revue critique de 45 études 2023-2026 (https://arxiv.org/html/2607.14035v1) : démontré — un contenu déjà récupéré peut changer sa propre citation, pertinence et position dominent, moteurs divergents et instables (recoupement d'URL de 0,11 à 0,18 entre Google, AI Overviews et Gemini ; 18 % des pages d'AI Overviews identiques sur deux mois ; 9 à 28 % de décisions qui changent à température 0). Non démontré : un gain durable de découverte organique, un lien entre score de citation et clics ou chiffre d'affaires.
- **Variabilité.** SparkToro / Gumshoe, janvier 2026 (**EMPIRIQUE**, partenaire vendeur) : 2 961 réponses ; moins d'une chance sur 100 d'obtenir deux fois la même liste de marques ; **taux de présence assez stable, rang instable**. Żatuchin 2026 (**PRÉPUBLICATION**, auteur dirigeant d'un éditeur de mesure) : une exécution retrouve 62 à 77 % des organisations trouvées en cinq ; 10 exécutions ≈ 90-95 % de 15 ; pour une seule requête, puissance de 0,15-0,19 à 5 exécutions, ≈ 0,8 à 15-25. La revue conseille 7-8 répétitions comme départ, ajustées par un pilote.

Lecture retenue (choix du concepteur, pas une règle publiée) : publier un **taux de présence avec intervalle de confiance**, jamais un rang seul ; ~5 répétitions par requête suffisent pour un agrégat sur beaucoup de requêtes ; une comparaison avant / après sur une requête précise en demande 15 à 25.

### 2.5 Consignes officielles Google et Bing

- **OFFICIEL** Google (https://developers.google.com/search/docs/appearance/ai-features) : aucune exigence ni optimisation spéciale pour AI Overviews / AI Mode ; être indexé et éligible à un extrait suffit. Données structurées non requises pour la recherche générative, mais doivent correspondre au contenu visible. Pas de découpage en petits morceaux, pas de longueur idéale. « Optimiser pour la recherche générative, c'est encore du SEO. » Chercher des mentions inauthentiques n'aide pas. Contrôles : règles Googlebot, `nosnippet`, `data-nosnippet`, `max-snippet`, `noindex`.
- **OFFICIEL** Bing (blog Webmaster, 2026-02-10) : IndexNow garde l'information fraîche dans la recherche et les expériences IA ; titres clairs, tableaux et FAQ aident à faire ressortir l'information. Aucune mention de schema.
- **MARKETING** Microsoft Advertising (2025-10-08) : le schema aide à comprendre le contenu ; éviter les murs de texte, les réponses cachées dans des onglets, l'information clé seulement en PDF ou image ; « pas de stratégie secrète ». Aucun effet chiffré.

### 2.6 Affirmations à ne jamais reprendre

1. `llms.txt` améliore la visibilité ou est lu par les robots IA.
2. « Le GEO augmente la visibilité de 40 % ».
3. Le balisage schema fait citer dans les réponses IA.
4. Il existe une longueur ou un découpage idéal pour les IA.
5. Bloquer `Google-Extended` retire d'AI Overviews.
6. `robots.txt` bloque tout accès IA (les robots de consultation utilisateur peuvent l'ignorer).
7. « Votre marque est n° N dans ChatGPT » (le rang varie d'une exécution à l'autre).
8. Les réponses API sont celles que voient les utilisateurs.
9. `DeepSeekBot`, `GrokBot`, `anthropic-ai`… sont des robots documentés.
10. Les mentions sur le web provoquent les citations IA (corrélations d'éditeurs seulement).
11. Un outil tiers mesure AI Overviews ou Copilot par une API officielle.
12. IndexNow fait entrer dans les réponses de Copilot.

## 3. Projets hors liste, serveurs MCP

Code lu par `gh api` pour les huit projets marqués **[code lu]** ; étoiles et dates relevées le 2026-11-27.

### 3.1 Outils de suivi de visibilité auto-hébergeables

| Projet | Langage / stockage | Interrogation | Extraction des mentions | Sentiment | Citations | Répétitions | Formule | Coûts | Tests | Licence / étoiles / dernier push |
|---|---|---|---|---|---|---|---|---|---|---|
| `limelit-co/open` [code lu] | Go / SQLite | API officielles + scrapers tiers, mode d'accès (`api` / `scraped`) jamais moyenné | déterministe : alias, domaine, garde « nom-phrase », rang dans la liste, positions en octets | aucun (version hébergée seulement) | classées own / competitor / social / informational / other par site enregistrable | non (une passe) | taux sur réponses distinctes ; part de voix ; avertissement n < 20, cellule n < 5 | plafond quotidien vérifié avant la passe | nombreux, règles liées à des tests nommés | Apache-2.0 / 454 / 2026-11-26 |
| `elmohq/elmo` [code lu] | TypeScript / PostgreSQL | API + 6 scrapers | candidats par chaîne + juge LLM probabiliste (seuil P > 0,3), empreinte par version de juge | probabilités 4 classes + citation du passage | oui, avec requêtes de déploiement (fan-out) | **oui** (`replication`) | taux et position | estimation en USD par appel, projection mensuelle, plafond 24 h comptant les tentatives | vitest + intégration + Bruno | MIT / 736 / 2026-11-26 |
| `oneglanse/oneglanse` [code lu] | TS / PostgreSQL + ClickHouse + Redis | **automatisation de navigateur furtive** des interfaces grand public, sessions connectées, proxy | entièrement LLM | LLM 0-100 | depuis l'interface | non | formule pondérée **calculée par le LLM** | non vu | minimes | MIT / 267 / 2026-11-13 |
| `danishashko/geo-aeo-tracker` [code lu] | Next.js / KV | scrapers Bright Data, ancrage Gemini, OpenRouter | regex Unicode, plus longue correspondance | lexique de mots | domaine propre dans les sources | seulement dans les essais « Rank Signal » | additive 30 + 20 + 15 + 20 + 15 | registre horaire en USD | nombreux, dont SSRF | MIT / 335 / 2026-11-11 |
| GetCito (`ai-search-guru/…`) [code lu] | JS / SQL | OpenAI Responses `web_search` + `user_location`, Anthropic, scraper cloro | regex, frontières adaptées aux écritures CJK, balisage `<Entity/>` retiré | appel gpt-5-mini en JSON | domaine propre | non vu | `100 × (0,6 mention + 0,25 citation + 0,15 position × m/(m+20))` | non vérifié | quelques-uns | MIT / 422 / 2026-11-05 |
| `aws-samples/sample-llm-search-citation-analysis-with-amazon-bedrock` [code lu] | Python Lambda / DynamoDB | API avec recherche + AI Overviews derrière un interrupteur | entièrement LLM, index canonique des marques, enveloppe anti-injection | LLM + citation | oui + exploration des pages citées | « exécutions répétées » (nombre non vérifié) | moyenne de `0,9^(position−1) × 100` | plafond d'appels | pytest | MIT-0 / 24 / 2026-11-23 |
| `yaojingang/GEOInflow` [migrations lues] | TS / ClickHouse + PostgreSQL | aucune (logs serveur) | — | — | — | — | couverture d'exploration | — | non vérifié | MIT / 880 / 2026-11-14 |
| `onvoyage-ai/gtm-engineer-skills` [code lu] | skills Markdown + scripts Node | aucune | — | — | — | — | grille à points (title 10, meta 10…) + six dimensions notées par l'agent | — | tests Node sur les contrats CSV | MIT / 1 376 / 2026-10-11 |

Non lus (README seulement ou rien) : `Fullspec-Studio/aeo-engine` (sans licence ; banc d'évaluation du juge sur cas étiquetés), `Open-Source-SEO-Tools/ai-visibility-tracker` (AGPL-3.0), `TrellaceTeam/overheard-ai`, `sinusdigital/spectacl`, `rastmob/ai-visibility-tracker`, `opencited/opencited` (sans licence), `leopard627/fire-your-seo-agency`, `mykpono/ultimate-seo-geo`, `dannwaneri/seo-agent`, `199-biotechnologies/claude-skill-seo-geo-optimizer`, `AndreasH96/seo-geo-consultant`. Recherche : `cxcscmu/AutoGEO` (ICLR 2026, MIT), `mverab/eGEOagents`. Une vingtaine de dépôts `rNN-*-claude-skills-seo` créés le même jour par des comptes jetables ressemblent à une ferme d'étoiles : ignorés.

Détails à retenir :

- **limelit** — le plus rigoureux. Schéma : `prompt` (`branded`, `category`, `location_country`), `target` (`moteur:fournisseur[:modèle][:online]`), `evaluation`, `chat` (statut `ok` / `failed` / `no_answer_surface`), `mention` (`brand_key`, positions, `list_rank`), `citation` (site, `source_type`), `usage_day`. Clé normalisée (minuscules, lettres et chiffres : « Run:AI » = « runai ») ; termes de moins de 3 caractères ignorés ; le domaine et le libellé `nom.tld` comptent ; garde « nom-phrase » (une marque comme « Kindle to PDF » ne compte que là où elle se lit comme un nom : 122 correspondances naïves pour 44 vraies sur 200 réponses). Toutes les réponses stockées sont ré-analysées en une transaction quand les règles ou la liste de marques changent. Requêtes avec marque exclues des chiffres principaux ; `no_answer_surface` exclu des dénominateurs. Requêtes générées par gabarits déterministes, sans appel de modèle.
- **elmo** — `prompt_runs` garde `raw_output`, `web_search_enabled`, `web_queries[]` ; tables dérivées reconstruisibles portant un tampon de version. Juge LLM sur passages candidats, à **seuil bas** pour qu'un juge hésitant ne cache pas une vraie mention. Projection de coût = requêtes × exécutions par jour × répétitions × 30.
- **danishashko** — seule vraie inférence trouvée : postérieure Beta de Jeffreys `Beta(w + 0,5, n − w + 0,5)`, intervalle à 95 %, points d'arrêt séquentiels à n = 20 / 30 / 40 avec verdict positif / négatif / pas d'effet net. Moteurs retirés (Copilot, Grok) notés dans le code.
- **aws-samples** — une « observation » = une marque par réponse à sa meilleure position ; les textes d'analyse écrits par le LLM partent seulement de faits calculés, et un validateur rejette tout nombre absent des preuves.
- **GEOInflow** — l'agent utilisateur déclaré, les plages IP officielles et la preuve DNS sont stockés **séparément** sur chaque ligne de log (`recognition_state`, `verification_reason`) ; inventaire du sitemap comparé aux pages réellement visitées ; mise en garde explicite : un log prouve l'accès, pas la citation.
- **gtm-engineer-skills** — contrat CSV strict des requêtes (étape, type, grappe, moteurs cibles, `brand_mention_mechanism`), validé par un test.

### 3.2 Serveurs MCP utiles (facultatifs, jamais requis)

| Domaine | Serveur | Licence | Remarque |
|---|---|---|---|
| Search Console + Bing + GA4 + PageSpeed | `saurabhsharma2u/search-console-mcp` | MIT | ~96 outils, lecture seule par défaut ; sa doc confirme qu'aucune API Google ou Bing ne donne les citations IA |
| Search Console + Bing + GA4 + CrUX | `FlorianBruniaux/google-search-console-mcp` | MIT | Python |
| Search Console seul | `surendranb/…`, `acamolese/…`, `ncosentino/google-search-console-mcp` | MIT | |
| Bing Webmaster | `ncosentino/bing-webmaster-mcp`, `parthguru/bing-webmaster-mcp` (lecture seule, liste blanche de sites) | MIT | 0-2 étoiles |
| SERP / données SEO | `dataforseo/mcp-server-typescript` (Apache-2.0), `serpapi/serpapi-mcp` (MIT), `SerpstatGlobal/*` | | payants à l'usage |
| Ahrefs | `ahrefs/ahrefs-mcp-server` | aucune, non maintenu | remplacé par le MCP distant d'Ahrefs |
| PageSpeed / Lighthouse | `PhialsBasement/Pagespeed-MCP-Server` (MIT), `lemon-squared/google-pagespeed-mcp-server` (Apache-2.0) ; `lighthouse_audit` de Chrome DevTools MCP | | |

Le plugin **détecte** ces serveurs dans la session et propose de les utiliser ; il n'en installe aucun et fonctionne sans.

### 3.3 Méthode publiée des outils commerciaux

Rare et surtout écrite par les éditeurs. Profound dit jouer chaque jour son portefeuille de requêtes par l'interface navigateur, pas l'API (https://www.tryprofound.com/blog/is-once-a-day-enough). Aucune déclaration de première main trouvée pour Otterly, Scrunch, AthenaHQ (non vérifié). Sources indépendantes ou d'autres éditeurs : une exécution par semaine est un sondage, pas une mesure (https://metehan.ai/articles/how-ai-visibility-tools-collect-data) ; au moins 5 exécutions puis 20+ (https://www.airops.com/glossary/answer-variance) ; **la variance entre requêtes dépasse la variance d'une même requête : ajouter des requêtes avant d'ajouter des répétitions** (https://cloro.dev/blog/ai-visibility-sample-size/) ; la plupart des outils ne jouent chaque requête qu'une fois par période (https://searchengineland.com/make-prompt-tracking-more-accurate-479708).

## 4. Ce que personne ne fait encore

Synthèse des sections 1.9 et 3 :

1. **Intervalles de confiance** sur les chiffres principaux (présence, part de voix) et verdict « changement significatif ou non » entre deux périodes.
2. **Choix de la taille d'échantillon** (nombre de requêtes, de répétitions) pour une marge d'erreur visée, dans l'outil.
3. **Mesure par les API officielles**, sans scraper, avec séparation stricte API / interface et enregistrement « recherche déclenchée ou non ».
4. **Validation du juge LLM** contre l'extracteur déterministe (taux d'accord, kappa) sur un jeu étiqueté.
5. **Jonction des trois flux de preuve par URL** : logs de robots, citations observées, requêtes Search Console / Bing.
6. **Expériences avant / après sur un vrai changement de page**, avec requêtes et pages témoins.
7. **Vérification des faits** que les moteurs affirment sur la marque, contre une source de vérité fournie par le propriétaire.
8. **Un plugin Claude Code qui mesure (répétitions + statistiques) ET audite et corrige le site.**
9. **Heuristiques non anglaises** (français d'abord, frontières CJK).
10. **Contenu collecté isolé** de l'agent qui a les outils d'écriture.

## 5. Licences : ce qui peut être repris

- MIT, Apache-2.0, MIT-0 (1.1 à 1.4, 1.6, 3.1 sauf exceptions) : réutilisation permise avec l'avis de droits d'auteur (et `NOTICE` pour Apache-2.0). **Choix du concepteur : aucun code repris**, idées réimplémentées et citées dans `THIRD_PARTY_LICENSES.md` ; les jeux de données publiés (registre de robots) sont reconstruits depuis les sources officielles, pas copiés.
- AGPL-3.0 (`Open-Source-SEO-Tools/ai-visibility-tracker`) : non lu, rien repris.
- Sans licence (`Didgeheads`, `aelena`, `Fullspec-Studio`, `opencited`, `ahrefs-mcp-server`) : idées seulement.
