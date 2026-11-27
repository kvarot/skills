import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { CATALOGUE, controler } from '../../outils/lib/controles.mjs'

const registre = JSON.parse(readFileSync(new URL('../../donnees/robots.json', import.meta.url), 'utf8'))
const O = 'https://www.exemple.example'

// In-memory Page shaped like collecter.mjs output (Faits + statut, entetes, profondeur, redirections, empreinte_texte).
function page(chemin, sur = {}) {
  const url = O + chemin
  return {
    url, lang: 'fr', title: 'Titre ' + chemin, description: 'Description ' + chemin, canonical: url, robots: null, hreflang: [],
    og: { title: null, description: null, image: null }, hn: [{ niveau: 1, texte: 'H1 ' + chemin }, { niveau: 2, texte: 'H2' }],
    images: [{ src: '/i.png', alt: 'Image', width: null, height: null }], liens: [], jsonld: [], mots: 200, corpsVide: false, montageSpa: false,
    viewport: 'width=device-width, initial-scale=1', auteur: null, dates: { publiee: '2026-01-01', modifiee: null }, nosnippet: false,
    blocs: [{ type: 'paragraphe', texte: 'Texte unique de ' + chemin }], rel: { prev: null, next: null }, ogSiteName: null,
    statut: 200, entetes: { x_robots_tag: null, content_type: 'text/html', last_modified: null }, profondeur: 1, redirections: [],
    empreinte_texte: 'h' + chemin,
    ...sur,
  }
}

// Two pages linking to each other, both in the sitemap: the clean baseline.
function collecte({ pages, site = {}, erreurs = [], exploration = {} } = {}) {
  const ps = pages ?? [
    page('/', { profondeur: 0, liens: [{ href: '/a', texte: 'A' }] }),
    page('/a', { liens: [{ href: '/', texte: 'Accueil' }] }),
  ]
  return {
    origine: O,
    pages: ps,
    site: {
      racine: O, robotsTxt: null, robotsStatut: 404,
      sitemaps: [{ url: O + '/sitemap.xml', urls: ps.map((p) => p.url) }],
      llmsTxt: null, llmsFullTxt: null, waf: null, urlsConnues: ps.map((p) => p.url), ...site,
    },
    erreurs,
    exploration: { pages: ps.length, limite_atteinte: false, profondeur_max: 1, ...exploration },
  }
}

const ctl = (c) => controler(c, registre)
const ids = (cs) => cs.map((c) => c.id)
const trouver = (cs, id) => cs.find((c) => c.id === id)
const LIEN_A = [{ href: '/a', texte: 'A' }]
const LIEN_ACCUEIL = [{ href: '/', texte: 'Accueil' }]

function attendu(cs, id, { type, severite }) {
  const c = trouver(cs, id)
  assert.ok(c, `constat ${id} attendu, obtenu : ${ids(cs).join(', ') || 'aucun'}`)
  assert.equal(c.preuve.type, type, `${id} : type de preuve`)
  assert.equal(c.severite, severite, `${id} : gravité`)
  assert.ok(c.preuve.url && c.preuve.detail, `${id} : preuve complète`)
  return c
}

test('site propre : aucun constat', () => {
  assert.deepEqual(ctl(collecte()), [])
})

test('catalogue : ids uniques, forme valide, gravités et catégories connues', () => {
  const vus = new Set()
  for (const e of CATALOGUE) {
    assert.ok(/^GEO-[A-Z0-9-]+$/.test(e.id), e.id)
    assert.ok(!vus.has(e.id), 'doublon ' + e.id)
    vus.add(e.id)
    assert.ok(['bloquant', 'important', 'mineur', 'information'].includes(e.severite), e.id)
    assert.ok(['indexation', 'robots-ia', 'rendu', 'structure', 'international', 'donnees-structurees', 'entite', 'contenu', 'performance', 'securite'].includes(e.categorie), e.id)
    assert.ok(['deterministe', 'heuristique'].includes(e.classe), e.id)
    assert.ok(e.description, e.id)
  }
  assert.equal(CATALOGUE.find((e) => e.id === 'GEO-LLMSTXT').severite, 'information')
})

test('parité : CATALOGUE et references/constats.md listent les mêmes ids, avec la même gravité', () => {
  const md = readFileSync(new URL('../../references/constats.md', import.meta.url), 'utf8')
  // Format : un titre `### GEO-XXX` par constat, suivi d'une ligne `**Gravité** : <gravité>`.
  const doc = [...md.matchAll(/^### (GEO-[A-Z0-9-]+)\s*\n+\*\*Gravité\*\* : (\w+)/gm)].map((m) => [m[1], m[2]])
  const titres = [...md.matchAll(/^### (GEO-[A-Z0-9-]+)/gm)].map((m) => m[1])
  assert.equal(doc.length, titres.length, 'chaque titre porte une ligne Gravité')
  assert.deepEqual(titres.toSorted(), CATALOGUE.map((e) => e.id).toSorted())
  for (const [id, sev] of doc) assert.equal(sev, CATALOGUE.find((e) => e.id === id).severite, id)
})

test('indexation : GEO-NOINDEX par meta et par x-robots-tag', () => {
  const cs = ctl(collecte({ pages: [
    page('/', { profondeur: 0, robots: 'noindex, follow', liens: LIEN_A }),
    page('/a', { entetes: { x_robots_tag: 'googlebot: noindex', content_type: 'text/html', last_modified: null }, liens: LIEN_ACCUEIL }),
  ] }))
  const c = attendu(cs, 'GEO-NOINDEX', { type: 'html', severite: 'bloquant' })
  assert.deepEqual(c.pages, [O + '/', O + '/a'])
  assert.match(c.detail, /x-robots-tag/)
  const seul = ctl(collecte({ pages: [page('/', { profondeur: 0, entetes: { x_robots_tag: 'none', content_type: null, last_modified: null } })] }))
  assert.equal(trouver(seul, 'GEO-NOINDEX').preuve.type, 'http')
})

test('indexation : GEO-ROBOTSTXT-BLOQUE-TOUT', () => {
  const cs = ctl(collecte({ site: { robotsTxt: 'User-agent: *\nDisallow: /\n' } }))
  attendu(cs, 'GEO-ROBOTSTXT-BLOQUE-TOUT', { type: 'robots', severite: 'bloquant' })
  assert.ok(!ids(ctl(collecte({ site: { robotsTxt: 'User-agent: *\nDisallow: /prive\n' } }))).includes('GEO-ROBOTSTXT-BLOQUE-TOUT'))
})

test('indexation : GEO-SITEMAP-ABSENT', () => {
  attendu(ctl(collecte({ site: { sitemaps: [] } })), 'GEO-SITEMAP-ABSENT', { type: 'sitemap', severite: 'important' })
  // A folder collection carries the raw sitemap.xml instead of parsed sitemaps.
  const dossier = collecte({ site: { racine: null, sitemaps: [], sitemapXml: '<urlset><url><loc>/</loc></url><url><loc>/a</loc></url></urlset>' } })
  assert.ok(!ids(ctl(dossier)).includes('GEO-SITEMAP-ABSENT'))
})

test('indexation : GEO-SITEMAP-INCOHERENT (noindex listé, autre hôte, URL en erreur, sitemap en erreur)', () => {
  const ps = [page('/', { profondeur: 0, liens: LIEN_A, robots: 'noindex' }), page('/a', { liens: LIEN_ACCUEIL })]
  const noindex = ctl(collecte({ pages: ps }))
  attendu(noindex, 'GEO-SITEMAP-INCOHERENT', { type: 'sitemap', severite: 'mineur' })
  const sain = () => [page('/', { profondeur: 0, liens: LIEN_A }), page('/a', { liens: LIEN_ACCUEIL })]
  const autreHote = ctl(collecte({ pages: sain(), site: { sitemaps: [{ url: O + '/sitemap.xml', urls: [O + '/', O + '/a', 'https://autre.example/x'] }] } }))
  assert.ok(ids(autreHote).includes('GEO-SITEMAP-INCOHERENT'))
  const enErreur = ctl(collecte({ pages: sain(), erreurs: [{ url: O + '/mort', raison: 'statut 404' }], site: { sitemaps: [{ url: O + '/sitemap.xml', urls: [O + '/', O + '/a', O + '/mort'] }] } }))
  assert.ok(ids(enErreur).includes('GEO-SITEMAP-INCOHERENT'))
  const sitemapEnErreur = ctl(collecte({ pages: sain(), site: { sitemaps: [{ url: O + '/sitemap.xml', urls: [], erreur: 'XML illisible' }] } }))
  assert.ok(ids(sitemapEnErreur).includes('GEO-SITEMAP-INCOHERENT'))
})

test('indexation : GEO-CANONICAL-ABSENT et GEO-CANONICAL-AUTRE-HOTE', () => {
  const cs = ctl(collecte({ pages: [
    page('/', { profondeur: 0, canonical: null, liens: LIEN_A }),
    page('/a', { canonical: 'https://autre.example/a', liens: LIEN_ACCUEIL }),
  ] }))
  attendu(cs, 'GEO-CANONICAL-ABSENT', { type: 'html', severite: 'mineur' })
  const c = attendu(cs, 'GEO-CANONICAL-AUTRE-HOTE', { type: 'html', severite: 'important' })
  assert.deepEqual(c.pages, [O + '/a'])
})

test('indexation : GEO-HTTP-ERREUR (statuts 4xx/5xx, pas les défis ni robots.txt)', () => {
  const cs = ctl(collecte({ erreurs: [
    { url: O + '/cassee', raison: 'statut 404' },
    { url: O + '/panne', raison: 'statut 500' },
    { url: O + '/x', raison: 'défi CDN/WAF (…) : page non analysée' },
    { url: O + '/prive', raison: 'interdit par robots.txt pour geo-audit' },
  ] }))
  const c = attendu(cs, 'GEO-HTTP-ERREUR', { type: 'http', severite: 'important' })
  assert.deepEqual(c.pages, [O + '/cassee', O + '/panne'])
})

test('indexation : GEO-REDIRECTION-CHAINE (> 2 sauts) et GEO-PROFONDEUR (> 3 clics)', () => {
  const cs = ctl(collecte({ pages: [
    page('/', { profondeur: 0, liens: LIEN_A }),
    page('/a', { liens: LIEN_ACCUEIL, redirections: [O + '/1', O + '/2', O + '/a'], profondeur: 4 }),
  ] }))
  attendu(cs, 'GEO-REDIRECTION-CHAINE', { type: 'http', severite: 'mineur' })
  attendu(cs, 'GEO-PROFONDEUR', { type: 'calcul', severite: 'mineur' })
  const limite = ctl(collecte({ pages: [
    page('/', { profondeur: 0, liens: LIEN_A }),
    page('/a', { liens: LIEN_ACCUEIL, redirections: [O + '/1', O + '/a'], profondeur: 3 }),
  ] }))
  assert.ok(!ids(limite).includes('GEO-REDIRECTION-CHAINE') && !ids(limite).includes('GEO-PROFONDEUR'))
})

test('indexation : GEO-PAGE-ORPHELINE (sitemap sans lien entrant)', () => {
  const site = { sitemaps: [{ url: O + '/sitemap.xml', urls: [O + '/', O + '/a', O + '/seule'] }] }
  const c = attendu(ctl(collecte({ site })), 'GEO-PAGE-ORPHELINE', { type: 'sitemap', severite: 'mineur' })
  assert.deepEqual(c.pages, [O + '/seule'])
  // Exploration cut short: an uncollected sitemap URL proves nothing.
  assert.ok(!ids(ctl(collecte({ site, exploration: { limite_atteinte: true } }))).includes('GEO-PAGE-ORPHELINE'))
  // Collected page listed in the sitemap but linked from nowhere.
  const ps = [page('/', { profondeur: 0 }), page('/b', { liens: LIEN_ACCUEIL })]
  const dossier = collecte({ pages: ps, site: { racine: null } })
  assert.deepEqual(trouver(ctl(dossier), 'GEO-PAGE-ORPHELINE').pages, [O + '/b'])
  // Crawl mode: a collected page was reached by some link, never an orphan.
  assert.ok(!ids(ctl(collecte({ pages: ps }))).includes('GEO-PAGE-ORPHELINE'))
})

test('indexation : GEO-CONTENU-DUPLIQUE (même empreinte sans canonical commun)', () => {
  const dup = (cano) => ctl(collecte({ pages: [
    page('/', { profondeur: 0, liens: [...LIEN_A, { href: '/b', texte: 'B' }] }),
    page('/a', { empreinte_texte: 'same', canonical: cano ?? O + '/a', liens: LIEN_ACCUEIL }),
    page('/b', { empreinte_texte: 'same', canonical: cano ?? O + '/b', liens: LIEN_ACCUEIL }),
  ] }))
  const c = attendu(dup(), 'GEO-CONTENU-DUPLIQUE', { type: 'calcul', severite: 'important' })
  assert.deepEqual(c.pages, [O + '/a', O + '/b'])
  assert.ok(!ids(dup(O + '/a')).includes('GEO-CONTENU-DUPLIQUE'))
})

test('robots-ia : OAI-SearchBot bloqué donne RECHERCHE-BLOQUE ; GPTBot seul donne seulement la politique', () => {
  const oai = ctl(collecte({ site: { robotsTxt: 'User-agent: OAI-SearchBot\nDisallow: /\n' } }))
  const c = attendu(oai, 'GEO-ROBOTS-RECHERCHE-BLOQUE', { type: 'robots', severite: 'bloquant' })
  assert.match(c.detail, /OAI-SearchBot/)
  assert.ok(c.pages.includes(O + '/'))
  const gpt = ctl(collecte({ site: { robotsTxt: 'User-agent: GPTBot\nDisallow: /\n' } }))
  assert.ok(!ids(gpt).includes('GEO-ROBOTS-RECHERCHE-BLOQUE'))
  assert.ok(!ids(gpt).includes('GEO-ROBOTSTXT-BLOQUE-TOUT'))
  const pol = attendu(gpt, 'GEO-ROBOTS-ENTRAINEMENT-POLITIQUE', { type: 'robots', severite: 'information' })
  assert.match(pol.detail, /GPTBot/)
  assert.deepEqual(ids(gpt), ['GEO-ROBOTS-ENTRAINEMENT-POLITIQUE'])
})

test('robots-ia : la politique d’entraînement ne recommande jamais d’autoriser', () => {
  for (const txt of ['User-agent: GPTBot\nDisallow: /\n', 'User-agent: *\nAllow: /\n']) {
    const c = trouver(ctl(collecte({ site: { robotsTxt: txt } })), 'GEO-ROBOTS-ENTRAINEMENT-POLITIQUE')
    assert.ok(c)
    assert.match(c.detail, /propriétaire/)
    assert.doesNotMatch(c.detail, /recommand(?!ation)|autoriser|il faut|devriez|conseill/i)
    assert.equal(c.classe, 'deterministe')
  }
})

test('robots-ia : jetons non documentés ne créent jamais de constat bloquant', () => {
  const cs = ctl(collecte({ site: { robotsTxt: 'User-agent: Bytespider\nDisallow: /\n\nUser-agent: anthropic-ai\nDisallow: /\n\nUser-agent: Claude-Web\nDisallow: /\n' } }))
  assert.ok(!cs.some((c) => c.severite === 'bloquant' || c.severite === 'important'))
  const pol = trouver(cs, 'GEO-ROBOTS-ENTRAINEMENT-POLITIQUE')
  assert.ok(!pol || !/Bytespider|anthropic-ai|Claude-Web/.test(pol.detail))
})

test('robots-ia : GEO-ROBOTS-CONSULTATION-BLOQUE', () => {
  const cs = ctl(collecte({ site: { robotsTxt: 'User-agent: ChatGPT-User\nDisallow: /\n' } }))
  attendu(cs, 'GEO-ROBOTS-CONSULTATION-BLOQUE', { type: 'robots', severite: 'important' })
  assert.ok(!ids(cs).includes('GEO-ROBOTS-RECHERCHE-BLOQUE'))
})

test('robots-ia : un blocage partiel ne désigne que les pages concernées', () => {
  const cs = ctl(collecte({ site: { robotsTxt: 'User-agent: OAI-SearchBot\nDisallow: /a\n' } }))
  assert.deepEqual(trouver(cs, 'GEO-ROBOTS-RECHERCHE-BLOQUE').pages, [O + '/a'])
})

test('robots-ia : GEO-WAF-DEFI et pas de GEO-HTML-VIDE sur la page défiée', () => {
  const waf = { detecte: true, preuve: { url: O + '/', statut: 403, detail: 'en-tête cf-mitigated: challenge' } }
  const cs = ctl(collecte({ pages: [page('/', { corpsVide: true, mots: 3, profondeur: 0 })], site: { waf } }))
  const c = attendu(cs, 'GEO-WAF-DEFI', { type: 'http', severite: 'bloquant' })
  assert.match(c.detail, /cf-mitigated/)
  assert.ok(!ids(cs).includes('GEO-HTML-VIDE'))
  const vide = ctl(collecte({ pages: [page('/', { corpsVide: true, mots: 3, profondeur: 0 })] }))
  attendu(vide, 'GEO-HTML-VIDE', { type: 'html', severite: 'bloquant' })
  // Challenged start page: nothing collected, only the challenge is reported.
  const sansPage = ctl(collecte({ pages: [], site: { waf, sitemaps: [] } }))
  assert.deepEqual(ids(sansPage), ['GEO-WAF-DEFI'])
})

test('robots-ia : GEO-NOSNIPPET (meta et x-robots-tag)', () => {
  const cs = ctl(collecte({ pages: [
    page('/', { profondeur: 0, nosnippet: true, robots: 'nosnippet', liens: LIEN_A }),
    page('/a', { entetes: { x_robots_tag: 'max-snippet:0', content_type: null, last_modified: null }, liens: LIEN_ACCUEIL }),
  ] }))
  const c = attendu(cs, 'GEO-NOSNIPPET', { type: 'html', severite: 'important' })
  assert.deepEqual(c.pages, [O + '/', O + '/a'])
  const ok = ctl(collecte({ pages: [page('/', { profondeur: 0, robots: 'max-snippet:50', liens: LIEN_A }), page('/a', { liens: LIEN_ACCUEIL })] }))
  assert.ok(!ids(ok).includes('GEO-NOSNIPPET'))
})

test('robots-ia : GEO-LLMSTXT présence et absence, phrase fixe, aucune recommandation', () => {
  const phrase = "sans effet démontré sur la visibilité ; Google déclare ne pas l'utiliser"
  for (const present of [true, false]) {
    const cs = ctl(collecte({ site: { llmsTxt: { present, statut: present ? 200 : 404 } } }))
    const c = attendu(cs, 'GEO-LLMSTXT', { type: 'http', severite: 'information' })
    assert.ok(c.detail.includes(phrase))
    assert.doesNotMatch(c.detail, /ajout|créez|recommand|améliore/i)
    assert.deepEqual(ids(cs), ['GEO-LLMSTXT'])
  }
  // present: null (refused, network failure, server error) = unknown: said as « non vérifié », never « absent ».
  const inconnu = trouver(ctl(collecte({ site: { llmsTxt: { present: null, statut: null } } })), 'GEO-LLMSTXT')
  assert.ok(inconnu)
  assert.match(inconnu.detail, /non vérifié/)
  assert.doesNotMatch(inconnu.detail, /absent/)
  assert.ok(!ids(ctl(collecte({ site: { llmsTxt: null } }))).includes('GEO-LLMSTXT'))
})

test('robots-ia : GEO-CONTENT-SIGNAL (valeur brute en extrait)', () => {
  const cs = ctl(collecte({ site: { robotsTxt: 'User-agent: *\nContent-Signal: ai-train=no, search=yes\nAllow: /\n' } }))
  const c = attendu(cs, 'GEO-CONTENT-SIGNAL', { type: 'robots', severite: 'information' })
  assert.equal(c.extrait.non_fiable, true)
  assert.match(c.extrait.extrait, /ai-train=no/)
})

test('rendu : GEO-VIEWPORT-ABSENT', () => {
  const cs = ctl(collecte({ pages: [page('/', { profondeur: 0, viewport: null, liens: LIEN_A }), page('/a', { liens: LIEN_ACCUEIL })] }))
  attendu(cs, 'GEO-VIEWPORT-ABSENT', { type: 'html', severite: 'mineur' })
})

test('structure : titre, description, h1, saut de niveaux, alt, langue', () => {
  const cs = ctl(collecte({ pages: [
    page('/', {
      profondeur: 0, title: null, description: null, lang: null, hn: [{ niveau: 2, texte: 'Sans h1' }, { niveau: 4, texte: 'Saut' }],
      images: [{ src: '/i.png', alt: null, width: null, height: null }, { src: '/d.png', alt: '', width: null, height: null }], liens: LIEN_A,
    }),
    page('/a', { liens: LIEN_ACCUEIL }),
  ] }))
  attendu(cs, 'GEO-TITLE-ABSENT', { type: 'html', severite: 'bloquant' })
  attendu(cs, 'GEO-DESC-ABSENT', { type: 'html', severite: 'mineur' })
  attendu(cs, 'GEO-H1-ABSENT', { type: 'html', severite: 'important' })
  attendu(cs, 'GEO-HN-SAUT', { type: 'html', severite: 'mineur' })
  const alt = attendu(cs, 'GEO-ALT-ABSENT', { type: 'html', severite: 'mineur' })
  assert.match(alt.detail, /1 image/) // alt="" is decorative, not missing
  attendu(cs, 'GEO-LANG-ABSENT', { type: 'html', severite: 'important' })
})

test('structure : h1, h2, h3 puis retour à h2 : pas de saut', () => {
  const ok = ctl(collecte({ pages: [page('/', { profondeur: 0, hn: [{ niveau: 1, texte: 'a' }, { niveau: 2, texte: 'b' }, { niveau: 3, texte: 'c' }, { niveau: 2, texte: 'd' }] })] }))
  assert.ok(!ids(ok).includes('GEO-HN-SAUT'))
})

test('structure : GEO-TITLE-DOUBLON', () => {
  const cs = ctl(collecte({ pages: [
    page('/', { profondeur: 0, title: 'Même titre', liens: LIEN_A }),
    page('/a', { title: ' même  titre ', liens: LIEN_ACCUEIL }),
  ] }))
  const c = attendu(cs, 'GEO-TITLE-DOUBLON', { type: 'html', severite: 'important' })
  assert.deepEqual(c.pages, [O + '/', O + '/a'])
  assert.equal(c.extrait.non_fiable, true)
})

test('international : GEO-HREFLANG-RECIPROQUE et GEO-HREFLANG-XDEFAULT', () => {
  const complet = [{ lang: 'fr', href: O + '/' }, { lang: 'en', href: O + '/en' }, { lang: 'x-default', href: O + '/' }]
  const cs = ctl(collecte({ pages: [
    page('/', { profondeur: 0, hreflang: complet, liens: [{ href: '/en', texte: 'EN' }] }),
    page('/en', { lang: 'en', hreflang: [{ lang: 'en', href: O + '/en' }], liens: LIEN_ACCUEIL }),
  ] }))
  const r = attendu(cs, 'GEO-HREFLANG-RECIPROQUE', { type: 'html', severite: 'important' })
  assert.deepEqual(r.pages, [O + '/'])
  const x = attendu(cs, 'GEO-HREFLANG-XDEFAULT', { type: 'html', severite: 'mineur' })
  assert.deepEqual(x.pages, [O + '/en'])
  const propre = ctl(collecte({ pages: [
    page('/', { profondeur: 0, hreflang: complet, liens: [{ href: '/en', texte: 'EN' }] }),
    page('/en', { lang: 'en', hreflang: complet, liens: LIEN_ACCUEIL }),
  ] }))
  assert.deepEqual(propre, [])
})

test('données structurées : GEO-JSONLD-INVALIDE', () => {
  const cs = ctl(collecte({ pages: [
    page('/', { profondeur: 0, jsonld: [{ brut: '{oups', objet: null, erreur: 'Expected property name' }], liens: LIEN_A }),
    page('/a', { liens: LIEN_ACCUEIL }),
  ] }))
  const c = attendu(cs, 'GEO-JSONLD-INVALIDE', { type: 'jsonld', severite: 'important' })
  assert.equal(c.extrait.non_fiable, true)
})

test('données structurées : GEO-JSONLD-AVIS-NON-VISIBLES', () => {
  const avis = { brut: '', erreur: null, objet: { '@context': 'https://schema.org', '@type': 'LocalBusiness', name: 'Cabinet Exemple', aggregateRating: { '@type': 'AggregateRating', ratingValue: '4.8', reviewCount: '120' } } }
  const sans = ctl(collecte({ pages: [page('/', { profondeur: 0, jsonld: [avis], liens: LIEN_A }), page('/a', { liens: LIEN_ACCUEIL })] }))
  attendu(sans, 'GEO-JSONLD-AVIS-NON-VISIBLES', { type: 'jsonld', severite: 'important' })
  const avec = ctl(collecte({ pages: [
    page('/', { profondeur: 0, jsonld: [avis], blocs: [{ type: 'paragraphe', texte: 'Note moyenne : 4,8 sur 5' }], liens: LIEN_A }),
    page('/a', { liens: LIEN_ACCUEIL }),
  ] }))
  assert.ok(!ids(avec).includes('GEO-JSONLD-AVIS-NON-VISIBLES'))
  const review = { brut: '', erreur: null, objet: { '@graph': [{ '@type': ['Product'], review: [{ '@type': 'Review', reviewRating: { ratingValue: 5 } }] }] } }
  // Individual Review ratings (shown as stars) are not checked.
  const r = ctl(collecte({ pages: [page('/', { profondeur: 0, jsonld: [review], blocs: [{ type: 'paragraphe', texte: 'Tarif 45 euros' }] })] }))
  assert.ok(!ids(r).includes('GEO-JSONLD-AVIS-NON-VISIBLES'))
  assert.equal(CATALOGUE.find((e) => e.id === 'GEO-JSONLD-AVIS-NON-VISIBLES').classe, 'heuristique')
  assert.equal(trouver(sans, 'GEO-JSONLD-AVIS-NON-VISIBLES').classe, 'heuristique')
  // Rounded to one decimal, comma or dot: 4.67 shown as 4,7.
  const arrondi = { brut: '', erreur: null, objet: { '@type': 'Product', aggregateRating: { '@type': 'AggregateRating', ratingValue: 4.67 }, review: [{ '@type': 'Review', reviewRating: { ratingValue: 3 } }] } }
  const ok = ctl(collecte({ pages: [page('/', { profondeur: 0, jsonld: [arrondi], blocs: [{ type: 'paragraphe', texte: 'Note : 4,7 / 5 (★★★)' }] })] }))
  assert.ok(!ids(ok).includes('GEO-JSONLD-AVIS-NON-VISIBLES'))
})

test('fraîcheur : GEO-DATE-ABSENTE (heuristique, pages d’article ou de documentation)', () => {
  const sansDate = (chemin, sur = {}) => page(chemin, { dates: { publiee: null, modifiee: null }, ...sur })
  const cs = ctl(collecte({ pages: [
    sansDate('/', { profondeur: 0, liens: [{ href: '/blog/x', texte: 'x' }] }),
    sansDate('/blog/x', { liens: LIEN_ACCUEIL }),
  ] }))
  const c = attendu(cs, 'GEO-DATE-ABSENTE', { type: 'html', severite: 'mineur' })
  assert.equal(c.classe, 'heuristique')
  assert.deepEqual(c.pages, [O + '/blog/x']) // the home page is not an article
  const article = ctl(collecte({ pages: [sansDate('/', { profondeur: 0, jsonld: [{ brut: '', erreur: null, objet: { '@type': 'BlogPosting' } }] })] }))
  assert.ok(ids(article).includes('GEO-DATE-ABSENTE'))
  const datee = ctl(collecte({ pages: [
    page('/', { profondeur: 0, liens: [{ href: '/blog/x', texte: 'x' }] }),
    page('/blog/x', { dates: { publiee: null, modifiee: '2026-03-01' }, liens: LIEN_ACCUEIL }),
  ] }))
  assert.ok(!ids(datee).includes('GEO-DATE-ABSENTE'))
})

test('un constat par id, ordre du catalogue, pages triées, sortie déterministe', () => {
  const faire = () => ctl(collecte({ pages: [
    page('/', { profondeur: 0, title: null, viewport: null, liens: [{ href: '/b', texte: 'b' }, { href: '/a', texte: 'a' }] }),
    page('/b', { title: null, viewport: null, liens: LIEN_ACCUEIL }),
    page('/a', { title: null, viewport: null, liens: LIEN_ACCUEIL }),
  ] }))
  const cs = faire()
  const liste = ids(cs)
  assert.equal(new Set(liste).size, liste.length)
  const rang = (id) => CATALOGUE.findIndex((e) => e.id === id)
  assert.deepEqual(liste, [...liste].sort((x, y) => rang(x) - rang(y)))
  assert.deepEqual(trouver(cs, 'GEO-TITLE-ABSENT').pages, [O + '/', O + '/a', O + '/b'])
  assert.deepEqual(faire(), cs)
  for (const c of cs) assert.ok(c.preuve && c.preuve.type && c.preuve.url && c.preuve.detail)
})

test('collecte vide ou partielle : jamais d’exception', () => {
  assert.doesNotThrow(() => controler({ pages: [], site: {}, erreurs: [], exploration: {} }, registre))
  assert.doesNotThrow(() => controler({}, registre))
  assert.doesNotThrow(() => controler(collecte(), undefined))
})

test('robustesse : href ou hreflang mal formé ne fait pas échouer le contrôle', () => {
  const cs = () => ctl(collecte({ pages: [
    page('/', { profondeur: 0, liens: [{ href: 'http://[oops', texte: 'x' }, ...LIEN_A], hreflang: [{ lang: 'en', href: 'http://[oops' }] }),
    page('/a', { liens: LIEN_ACCUEIL }),
  ] }))
  assert.doesNotThrow(cs)
})

test('orphelines : lien avec paramètre de suivi ou redirection ne créent pas de faux orphelin', () => {
  const site = { sitemaps: [{ url: O + '/sitemap.xml', urls: [O + '/', O + '/a', O + '/contact/'] }] }
  // /contact redirects to /contact/ (collected there, in the sitemap), reached from a link to /contact.
  const redir = ctl(collecte({ site, pages: [
    page('/', { profondeur: 0, liens: [{ href: '/a', texte: 'A' }, { href: '/contact', texte: 'C' }] }),
    page('/a', { liens: LIEN_ACCUEIL }),
    page('/contact/', { redirections: [O + '/contact/'], liens: LIEN_ACCUEIL }),
  ] }))
  assert.ok(!ids(redir).includes('GEO-PAGE-ORPHELINE'))
  // Uncollected sitemap URL reached through a link carrying tracking parameters and a fragment.
  const suivi = ctl(collecte({ site: { sitemaps: [{ url: O + '/sitemap.xml', urls: [O + '/', O + '/a', O + '/b'] }] }, pages: [
    page('/', { profondeur: 0, liens: [{ href: '/a?utm_source=x#haut', texte: 'A' }, { href: '/b?utm_medium=y', texte: 'B' }] }),
    page('/a', { liens: LIEN_ACCUEIL }),
  ] }))
  assert.ok(!ids(suivi).includes('GEO-PAGE-ORPHELINE'))
})

test('contenu dupliqué : une page sans canonical et une avec canonical ne partagent pas de canonical commun', () => {
  const cs = ctl(collecte({ pages: [
    page('/', { profondeur: 0, liens: [...LIEN_A, { href: '/b', texte: 'B' }] }),
    page('/a', { empreinte_texte: 'same', canonical: null, liens: LIEN_ACCUEIL }),
    page('/b', { empreinte_texte: 'same', canonical: O + '/a', liens: LIEN_ACCUEIL }),
  ] }))
  assert.ok(!ids(cs).includes('GEO-CONTENU-DUPLIQUE'))
})

test('noindex : seulement la page de départ et les pages du sitemap', () => {
  const ps = () => [
    page('/', { profondeur: 0, liens: [...LIEN_A, { href: '/merci', texte: 'M' }] }),
    page('/a', { liens: LIEN_ACCUEIL }),
    page('/merci', { robots: 'noindex', liens: LIEN_ACCUEIL }),
  ]
  const horsSitemap = ctl(collecte({ pages: ps(), site: { sitemaps: [{ url: O + '/sitemap.xml', urls: [O + '/', O + '/a'] }] } }))
  assert.ok(!ids(horsSitemap).includes('GEO-NOINDEX'))
  const listee = ctl(collecte({ pages: ps() }))
  assert.deepEqual(trouver(listee, 'GEO-NOINDEX').pages, [O + '/merci'])
})

const NL = String.fromCharCode(10)
const robotsTxt = (...lignes) => lignes.join(NL) + NL

test('robots-ia : la politique liste aussi jetons de contrôle et CCBot, sans recommandation', () => {
  const c = trouver(ctl(collecte({ site: { robotsTxt: robotsTxt('User-agent: Google-Extended', 'Disallow: /', '', 'User-agent: CCBot', 'Disallow: /') } })), 'GEO-ROBOTS-ENTRAINEMENT-POLITIQUE')
  assert.match(c.detail, /jetons de contrôle - bloqués : Google-Extended/)
  assert.match(c.detail, /corpus ouvert - bloqués : CCBot/)
  assert.doesNotMatch(c.detail, /recommand(?!ation)|autoriser|il faut|conseill/i)
})

test('robots-ia : Google-CloudVertexBot bloqué ne déclenche pas GEO-ROBOTS-RECHERCHE-BLOQUE', () => {
  const cs = ctl(collecte({ site: { robotsTxt: robotsTxt('User-agent: Google-CloudVertexBot', 'Disallow: /') } }))
  assert.ok(!ids(cs).includes('GEO-ROBOTS-RECHERCHE-BLOQUE'))
})

test('structure : un même canonical (variantes /x et /x/) n’est pas un titre en doublon', () => {
  const cs = ctl(collecte({ pages: [
    page('/', { profondeur: 0, liens: LIEN_A }),
    page('/a', { title: 'Merci', canonical: O + '/a/', liens: LIEN_ACCUEIL }),
    page('/a/', { title: 'Merci', canonical: O + '/a/', liens: LIEN_ACCUEIL }),
  ] }))
  assert.ok(!ids(cs).includes('GEO-TITLE-DOUBLON'))
})

test('rendu : une page courte en noindex n’est pas un HTML vide', () => {
  const merci = ctl(collecte({ pages: [
    page('/', { profondeur: 0, liens: LIEN_A }),
    page('/a', { corpsVide: true, mots: 6, robots: 'noindex', liens: LIEN_ACCUEIL }),
  ] }))
  assert.ok(!ids(merci).includes('GEO-HTML-VIDE'))
  const entete = ctl(collecte({ pages: [
    page('/', { profondeur: 0, liens: LIEN_A }),
    page('/a', { corpsVide: true, mots: 6, entetes: { x_robots_tag: 'noindex', content_type: 'text/html', last_modified: null }, liens: LIEN_ACCUEIL }),
  ] }))
  assert.ok(!ids(entete).includes('GEO-HTML-VIDE'))
  const indexee = ctl(collecte({ pages: [
    page('/', { profondeur: 0, liens: LIEN_A }),
    page('/a', { corpsVide: true, mots: 6, liens: LIEN_ACCUEIL }),
  ] }))
  assert.ok(ids(indexee).includes('GEO-HTML-VIDE'))
})

// --- final review ---
test('I1 : robots.txt 5xx ou sans réponse : GEO-ROBOTSTXT-INACCESSIBLE bloquant, pas de faux GEO-SITEMAP-ABSENT', () => {
  for (const statut of [503, 500, 0]) {
    const cs = ctl(collecte({ pages: [], site: { robotsTxt: null, robotsStatut: statut, sitemaps: [], sitemapsNonVerifies: 1, llmsTxt: { present: null, statut: null } } }))
    const c = attendu(cs, 'GEO-ROBOTSTXT-INACCESSIBLE', { type: 'robots', severite: 'bloquant' })
    assert.deepEqual(c.pages, [])
    assert.match(c.preuve.detail, /RFC 9309/)
    assert.equal(c.preuve.commande, `curl -sI '${O}/robots.txt'`)
    assert.ok(!ids(cs).includes('GEO-SITEMAP-ABSENT'), `statut ${statut}`)
    assert.match(trouver(cs, 'GEO-LLMSTXT').detail, /non vérifié/)
  }
  // 404 = no restriction, 200 = rules read: never inaccessible.
  for (const statut of [404, 200]) assert.ok(!ids(ctl(collecte({ site: { robotsStatut: statut } }))).includes('GEO-ROBOTSTXT-INACCESSIBLE'))
  // Folder mode: no HTTP status, never inaccessible.
  assert.ok(!ids(ctl({ pages: [], site: { racine: null, robotsStatut: 0 } })).includes('GEO-ROBOTSTXT-INACCESSIBLE'))
})

test('I1 : Disallow: / avec un Sitemap: déclaré mais non lu : BLOQUE-TOUT, pas de GEO-SITEMAP-ABSENT', () => {
  const cs = ctl(collecte({ pages: [], site: { robotsTxt: 'User-agent: *\nDisallow: /\nSitemap: /plan.xml\n', robotsStatut: 200, sitemaps: [], sitemapsNonVerifies: 1 } }))
  assert.ok(ids(cs).includes('GEO-ROBOTSTXT-BLOQUE-TOUT'))
  assert.ok(!ids(cs).includes('GEO-SITEMAP-ABSENT'))
  // Sitemaps really absent (asked, not found): still reported.
  assert.ok(ids(ctl(collecte({ site: { sitemaps: [], sitemapsNonVerifies: 0 } }))).includes('GEO-SITEMAP-ABSENT'))
})

test('preuve.commande : curl -sI rejouable, URL de page encodée, detail sans commande', () => {
  const url = `${O}/a'b$(id)` + '`x`'
  const cs = ctl(collecte({ pages: [page('/', { profondeur: 0 })], erreurs: [{ url, raison: 'statut 404' }] }))
  const c = trouver(cs, 'GEO-HTTP-ERREUR')
  assert.equal(c.preuve.commande, `curl -sI '${O}/a%27b$(id)%60x%60'`)
  assert.doesNotMatch(c.preuve.detail, /curl/)
  const waf = trouver(ctl(collecte({ site: { waf: { detecte: true, preuve: { url: O + '/', statut: 403, detail: 'cf' } } } })), 'GEO-WAF-DEFI')
  assert.equal(waf.preuve.commande, `curl -sI '${O}/'`)
})

test('M5 : mode dossier : aucune commande sans origine, la preuve nomme le fichier', () => {
  const p1 = page('/', { profondeur: 0, robots: 'noindex', fichier: 'index.html' })
  p1.url = '/'
  const cs = controler({ pages: [p1], site: { racine: null, robotsTxt: null, sitemaps: [], llmsTxt: { present: false, statut: null } }, erreurs: [] }, registre)
  for (const c of cs) assert.equal(c.preuve.commande, undefined, c.id)
  assert.match(trouver(cs, 'GEO-NOINDEX').preuve.detail, /mode dossier : fichier index\.html/)
  assert.match(trouver(cs, 'GEO-LLMSTXT').preuve.detail, /mode dossier : fichier llms\.txt/)
  assert.ok(!JSON.stringify(cs).includes('curl'))
})
