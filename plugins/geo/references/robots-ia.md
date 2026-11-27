# Robots d'IA et robots.txt

Référence chargée par les skills du plugin. Données : `donnees/robots.json` (vérifiées le 2026-11-27, chaque entrée porte sa source). Évaluation : `outils/lib/robots.mjs` (RFC 9309).

## Règle de conduite

Ne jamais recommander d'autoriser les robots d'entraînement. Le constat décrit la politique observée dans le `robots.txt` du site ; le choix revient au propriétaire du site.

## Les quatre rôles

| Rôle | Ce que fait le robot | Ce que change le blocage (selon les éditeurs) |
|---|---|---|
| `entrainement` | Collecte des contenus pour entraîner des modèles (ex. `GPTBot`, `ClaudeBot`, `MistralAI-Training`). | Le contenu n'est plus collecté pour l'entraînement par ce robot. |
| `indexation` | Construit un index de recherche (ex. `OAI-SearchBot`, `Claude-SearchBot`, `PerplexityBot`, `Googlebot`, `bingbot`). | Le site peut disparaître des réponses du moteur concerné. OpenAI indique que bloquer `OAI-SearchBot` rend le site absent des réponses de ChatGPT search. |
| `consultation-utilisateur` | Récupère une page quand un utilisateur le demande dans un assistant (ex. `ChatGPT-User`, `Claude-User`, `Perplexity-User`). | Voir l'avertissement ci-dessous : plusieurs éditeurs indiquent que robots.txt peut ne pas s'appliquer. |
| `controle` | Jeton qui ne visite rien : il porte seulement une règle (`Google-Extended`, `Applebot-Extended`). | Retire le contenu de l'usage visé (entraînement et ancrage Gemini / Vertex pour Google ; entraînement pour Apple). |

Le rôle `autre` regroupe les robots qui ne rentrent pas dans ces catégories (pages d'annonces, recherche interne, corpus ouvert) ainsi que les jetons non documentés.

## Points à ne pas déformer

1. **Robots de consultation utilisateur.** Selon leurs éditeurs, ils peuvent ne pas appliquer robots.txt : OpenAI pour `ChatGPT-User` (« peut ne pas s'appliquer »), Google pour `Google-Agent` et `Google-GeminiNotebook` (« ignore généralement »), Perplexity pour `Perplexity-User` (« ignore généralement »), Meta pour `meta-externalfetcher` (« peut contourner »), Amazon pour `Amzn-User` (« peut ne pas suivre »). Anthropic déclare de façon générale que `Claude-User` respecte robots.txt. Conséquence : un `robots.txt` ne bloque pas tout accès IA ; ne jamais l'affirmer.
2. **`Google-Extended` n'agit pas sur Google Search.** C'est un jeton de contrôle pour l'entraînement et l'ancrage Gemini / Vertex. Le bloquer ne retire pas le site d'AI Overviews ni d'AI Mode : ces fonctions dépendent de `Googlebot`.
3. **Jetons non documentés.** `Bytespider`, `TikTokSpider`, `GrokBot`, `xAI-Grok`, `xAI-SearchBot`, `DeepSeekBot`, `cohere-ai`, `anthropic-ai` et `Claude-Web` ne sont pas documentés par leur éditeur (tiers seulement). Le registre les garde avec `documente: false` et le constat ne les présente jamais comme officiels. Cohere déclare ne pas explorer le web.
4. **Signal AIPREF.** Google annonce la prise en charge de `user-agent: __usage_ai-training` début 2027 : pas actif aujourd'hui, ne rien en déduire.
5. **`Content-Signal:`** est relevé tel quel (valeur brute) ; il n'est pas évalué ici.

## Lecture d'un robots.txt (RFC 9309)

- Le jeton du robot est comparé sans tenir compte de la casse ; plusieurs lignes `User-agent` successives forment un groupe ; les groupes qui nomment le même robot sont fusionnés.
- Un groupe nommant le robot l'emporte sur le groupe `*` (le groupe `*` ne s'applique que si aucun groupe spécifique ne correspond).
- Règle la plus longue gagne ; à égalité, `Allow` gagne. `*` et `$` sont pris en charge. `Disallow:` vide n'interdit rien. Les lignes avant le premier `User-agent` sont ignorées. Les lignes `Sitemap:` sont globales.
- Repli : `Applebot` suit les règles de `Googlebot` quand aucun groupe ne le nomme (champ `repli` du registre, `groupe: 'repli'`), avant le groupe `*`.
- Absence de robots.txt : tout est autorisé (`groupe: 'aucun'`).

## Sources

- OpenAI : https://developers.openai.com/api/docs/bots
- Anthropic : https://support.claude.com/en/articles/8896518
- Google : https://developers.google.com/crawling/docs/crawlers-fetchers/google-common-crawlers , https://developers.google.com/crawling/docs/crawlers-fetchers/google-agent , https://developers.google.com/search/docs/crawling-indexing/google-user-triggered-fetchers , https://developers.google.com/crawling/docs/crawlers-fetchers/verify-google-requests
- Perplexity : https://docs.perplexity.ai/guides/bots
- Apple : https://support.apple.com/en-us/119829
- Meta : https://developers.facebook.com/docs/sharing/webmasters/web-crawlers/
- Amazon : https://developer.amazon.com/amazonbot
- Common Crawl : https://commoncrawl.org/ccbot
- Mistral : https://docs.mistral.ai/robots
- DuckDuckGo : https://duckduckgo.com/duckduckgo-help-pages/results/duckassistbot
- You.com : https://you.com/docs/youbot
- Cohere : https://docs.cohere.com/docs/cohere-web-crawlers
- Microsoft (`bingbot`) : https://www.bing.com/toolbox/bingbot.json (les pages d'aide Bing n'étaient pas lisibles ; le lien avec Copilot n'est pas vérifié officiellement).
