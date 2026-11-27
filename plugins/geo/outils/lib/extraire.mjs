// Adapted from plugins/seo/outils/extraire.mjs (same author, MIT).
// Extracts page facts from an HTML string with a small tag tokenizer (no DOM, no deps).
// extraire(html, url) -> Faits. Never throws: on any failure it returns empty facts.
// Beyond the SEO facts, it also yields viewport, author, dates, snippet controls and the
// ordered content blocks (heading / paragraph / list / table / definition) that the
// passage analyser consumes.

const NAMED = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', copy: '©', reg: '®', hellip: '…',
  ndash: '–', mdash: '—', laquo: '«', raquo: '»', rsquo: '’', lsquo: '‘', euro: '€',
  eacute: 'é', egrave: 'è', ecirc: 'ê', agrave: 'à', acirc: 'â', ccedil: 'ç', ocirc: 'ô',
  ucirc: 'û', icirc: 'î', Eacute: 'É',
}

function decode(s) {
  return s.replace(/&(?:#(\d+)|#[xX]([0-9a-fA-F]+)|([A-Za-z][A-Za-z0-9]*));/g, (m, dec, hex, name) => {
    try {
      if (dec || hex) return String.fromCodePoint(dec ? parseInt(dec, 10) : parseInt(hex, 16))
      return name in NAMED ? NAMED[name] : m
    } catch { return m }
  })
}

const nettoyer = (s) => s.replace(/\s+/g, ' ').trim()

// Elements whose content is raw text (no nested tags).
const RAW = new Set(['script', 'style', 'noscript', 'title', 'textarea'])
// Ids of client-side application mount containers (Vue, React, Nuxt, Next, Quasar, Svelte...).
const MONTAGE_SPA = new Set(['app', 'root', '__nuxt', '__next', 'q-app', 'svelte'])
// Elements allowed in <head>; any other start tag implicitly begins the body.
const HEAD_OK = new Set(['html', 'head', 'title', 'meta', 'link', 'base', 'script', 'style', 'noscript', 'template'])
// Void elements: they never have a closing tag, so they cannot open a data-nosnippet region.
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr'])
// Generic containers that end any run of loose text (and an open paragraph).
const CONTENEURS = new Set(['div', 'section', 'article', 'main', 'aside', 'header', 'footer', 'nav', 'form',
  'blockquote', 'figure', 'figcaption', 'details', 'summary', 'address', 'fieldset', 'body', 'hr'])

// Parses the attributes of a start tag body (after the tag name). Names are lowercased.
function attributs(s) {
  const out = {}
  const re = /([^\s"'<>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g
  let m
  while ((m = re.exec(s))) {
    const nom = m[1].toLowerCase()
    if (nom in out) continue
    const v = m[2] ?? m[3] ?? m[4]
    out[nom] = v === undefined ? '' : decode(v)
  }
  return out
}

// Finds the end of a start tag, honouring quoted values. Returns index of '>' or -1.
function finTag(html, debut) {
  let q = null
  for (let i = debut; i < html.length; i++) {
    const c = html[i]
    if (q) { if (c === q) q = null } else if (c === '"' || c === "'") q = c
    else if (c === '>') return i
  }
  return -1
}

function vide(url) {
  return {
    url, lang: null, title: null, description: null, canonical: null, robots: null, hreflang: [],
    og: { title: null, description: null, image: null }, hn: [], images: [], liens: [],
    jsonld: [], mots: 0, corpsVide: true, montageSpa: false,
    viewport: null, auteur: null, dates: { publiee: null, modifiee: null }, nosnippet: false,
    blocs: [], rel: { prev: null, next: null }, ogSiteName: null,
  }
}

function compterMots(texte) {
  let n = 0
  for (const t of texte.split(/\s+/)) if (/[\p{L}\p{N}]/u.test(t)) n++
  return n
}

// Top-level JSON-LD nodes: the object itself, array members and @graph members.
function noeudsJsonld(jsonld) {
  const out = []
  const visiter = (x, prof) => {
    if (prof > 4 || x === null || typeof x !== 'object') return
    if (Array.isArray(x)) { for (const e of x) visiter(e, prof + 1); return }
    out.push(x)
    if (x['@graph']) visiter(x['@graph'], prof + 1)
  }
  for (const j of jsonld) if (j.objet) visiter(j.objet, 0)
  return out
}

const chaine = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null)

// First usable string among a value that may be a string or an array of values.
function premiereChaine(v) {
  if (Array.isArray(v)) { for (const e of v) { const s = premiereChaine(e); if (s) return s } return null }
  return chaine(v)
}

// Author name from a JSON-LD "author" value: string, {name}, or an array of those.
function nomAuteur(a) {
  if (Array.isArray(a)) { for (const e of a) { const s = nomAuteur(e); if (s) return s } return null }
  if (a && typeof a === 'object') return chaine(a.name)
  return chaine(a)
}

function analyser(html, url) {
  const f = vide(url)
  let pos = 0
  let dansHead = false
  let bodyCommence = false
  let svg = 0
  let hn = null // { niveau, texte, nosnippet }
  let lien = null // { href, texte, auteur }
  let texteVisible = ''
  let auteurMeta = null
  let auteurRel = null
  let tempsPremier = null
  const dateMeta = { publiee: null, modifiee: null }
  const n = html.length

  // --- Content blocks -------------------------------------------------------------
  // Blocks are pushed into f.blocs when they open (document order) and filled when they
  // close; the ones left empty are dropped at the end. `pile` holds the open blocks.
  const pile = []
  const libre = { buf: '', ns: false } // loose text outside any block (e.g. inside a <div>)
  let ns = null // open data-nosnippet region: { nom, prof }

  const flushLibre = () => {
    const t = nettoyer(libre.buf)
    if (t) {
      const b = { type: 'paragraphe', texte: t }
      if (libre.ns) b.nosnippet = true
      f.blocs.push(b)
    }
    libre.buf = ''
    libre.ns = false
  }
  const joindre = (items) => items.map(nettoyer).filter(Boolean).join('\n')
  const finirItem = (s) => { if (s.cur !== null) { s.items.push(s.cur); s.cur = null } }
  const finirCellule = (s) => { if (s.cell !== null) { s.row.push(nettoyer(s.cell)); s.cell = null } }
  const finirLigne = (s) => {
    finirCellule(s)
    if (s.row) { const l = s.row.filter(Boolean).join(' | '); if (l) s.items.push(l); s.row = null }
  }
  const fermer = () => {
    const s = pile.pop()
    if (!s) return
    if (s.type === 'paragraphe') s.bloc.texte = nettoyer(s.buf)
    else if (s.type === 'tableau') { finirLigne(s); s.bloc.texte = s.items.join('\n') }
    else { finirItem(s); s.bloc.texte = joindre(s.items) }
    // Keep words apart where a nested block interrupted the enclosing item.
    const p = dessus()
    if (p && p.cur !== null) p.cur += ' '
  }
  const dessus = () => pile[pile.length - 1]
  const fermerParagraphe = () => { if (pile.length && dessus().type === 'paragraphe') fermer() }
  const ouvrir = (type) => {
    flushLibre()
    fermerParagraphe()
    const hote = dessus()
    if (hote && hote.cur !== null) hote.cur += ' '
    const bloc = { type, texte: '' }
    if (ns) bloc.nosnippet = true
    f.blocs.push(bloc)
    pile.push({ type, bloc, buf: '', items: [], cur: null, row: null, cell: null })
  }
  // Closes open blocks down to (and including) the nearest block of this type, if any.
  const fermerJusqua = (type) => {
    if (!pile.some((s) => s.type === type)) return
    while (pile.length) { const t = dessus().type; fermer(); if (t === type) break }
  }
  // Closes blocks opened above the nearest block of this type and returns it (or null).
  const trouver = (type) => {
    let i = pile.length - 1
    while (i >= 0 && pile[i].type !== type) i--
    if (i < 0) return null
    while (pile.length - 1 > i) fermer()
    return pile[i]
  }
  const ajouterTexte = (t) => {
    const s = dessus()
    // Inside a data-nosnippet region, text of an unflagged host block goes to a flagged block.
    if (!s || (ns && !s.bloc.nosnippet)) {
      if (!libre.buf) libre.ns = ns !== null
      libre.buf += t
    } else if (s.type === 'paragraphe') s.buf += t
    else if (s.type === 'tableau') { if (s.cell !== null) s.cell += t }
    else if (s.cur !== null) s.cur += t
  }

  const texte = (t) => {
    if (hn) hn.texte += t
    else if (svg === 0 && !dansHead) ajouterTexte(t)
    if (lien) lien.texte += t
    if (!dansHead) texteVisible += ' ' + t
  }
  const fermerHn = () => {
    if (!hn) return
    const t = nettoyer(hn.texte)
    f.hn.push({ niveau: hn.niveau, texte: t })
    if (t) {
      const b = { type: 'titre', niveau: hn.niveau, texte: t }
      if (hn.nosnippet) b.nosnippet = true
      f.blocs.push(b)
    }
    hn = null
  }
  const fermerLien = () => {
    if (!lien) return
    const t = nettoyer(lien.texte)
    f.liens.push({ href: lien.href, texte: t })
    if (lien.auteur && auteurRel === null && t) auteurRel = t
    lien = null
  }

  while (pos < n) {
    const lt = html.indexOf('<', pos)
    if (lt === -1) { texte(decode(html.slice(pos))); break }
    if (lt > pos) texte(decode(html.slice(pos, lt)))
    if (html.startsWith('<!--', lt)) {
      const e = html.indexOf('-->', lt + 4)
      pos = e === -1 ? n : e + 3
      continue
    }
    const suite = html[lt + 1]
    if (suite === '!' || suite === '?') {
      const e = html.indexOf('>', lt)
      pos = e === -1 ? n : e + 1
      continue
    }
    if (suite === '/') {
      const e = html.indexOf('>', lt)
      const nom = (/^<\/\s*([A-Za-z][A-Za-z0-9:-]*)/.exec(html.slice(lt, lt + 40)) || [])[1]
      pos = e === -1 ? n : e + 1
      if (!nom) continue
      const t = nom.toLowerCase()
      if (/^h[1-6]$/.test(t)) fermerHn()
      else if (t === 'a') fermerLien()
      else if (t === 'head') dansHead = false
      else if (t === 'svg' && svg > 0) svg--
      else if (t === 'p') fermerJusqua('paragraphe')
      else if (t === 'ul' || t === 'ol') fermerJusqua('liste')
      else if (t === 'table') fermerJusqua('tableau')
      else if (t === 'dl') fermerJusqua('definition')
      else if (t === 'li') { const s = trouver('liste'); if (s) finirItem(s) }
      else if (t === 'tr') { const s = trouver('tableau'); if (s) finirLigne(s) }
      else if (t === 'td' || t === 'th') { const s = trouver('tableau'); if (s) finirCellule(s) }
      else if (t === 'dt' || t === 'dd') { const s = trouver('definition'); if (s) finirItem(s) }
      if (CONTENEURS.has(t)) { flushLibre(); fermerParagraphe() }
      if (ns && t === ns.nom && --ns.prof <= 0) {
        flushLibre()
        while (pile.length && dessus().bloc.nosnippet) fermer()
        ns = null
      }
      continue
    }
    if (!suite || !/[A-Za-z]/.test(suite)) { texte('<'); pos = lt + 1; continue }

    const fin = finTag(html, lt + 1)
    const corps = html.slice(lt + 1, fin === -1 ? n : fin)
    pos = fin === -1 ? n : fin + 1
    const m = /^([A-Za-z][A-Za-z0-9:-]*)([\s\S]*)$/.exec(corps)
    const nom = m[1].toLowerCase()
    const at = attributs(m[2])
    const autoFermant = corps.endsWith('/')

    if (!HEAD_OK.has(nom)) { dansHead = false; bodyCommence = true }
    if (at.id !== undefined && MONTAGE_SPA.has(at.id.trim().toLowerCase())) f.montageSpa = true
    if (nom === 'svg' && !autoFermant) svg++
    if (RAW.has(nom) && !autoFermant) {
      // Raw text content runs up to the matching close tag (or end of input if truncated).
      const re = new RegExp('</' + nom + '(?=[\\s>/]|$)', 'i')
      const reste = html.slice(pos)
      const c = re.exec(reste)
      const contenu = c ? reste.slice(0, c.index) : reste
      if (c) {
        const e = html.indexOf('>', pos + c.index)
        pos = e === -1 ? n : e + 1
      } else pos = n
      if (nom === 'title') { if (f.title === null && svg === 0 && !bodyCommence) f.title = nettoyer(decode(contenu)) }
      else if (nom === 'script' && /^application\/ld\+json$/i.test((at.type || '').split(';')[0].trim())) {
        const brut = contenu.trim()
        try { f.jsonld.push({ brut, objet: JSON.parse(brut), erreur: null }) }
        catch (e) { f.jsonld.push({ brut, objet: null, erreur: String(e && e.message || e) || 'invalid JSON' }) }
      }
      continue
    }

    // data-nosnippet region: opened by the attribute, closed by the matching end tag.
    if (!VOID.has(nom) && !autoFermant && !dansHead) {
      if (ns) { if (nom === ns.nom) ns.prof++ }
      else if (at['data-nosnippet'] !== undefined) { flushLibre(); ns = { nom, prof: 1 } }
    }
    if (CONTENEURS.has(nom)) { flushLibre(); fermerParagraphe() }

    if (nom === 'html') { if (f.lang === null && at.lang !== undefined) f.lang = at.lang.trim() }
    else if (nom === 'head') dansHead = true
    else if (nom === 'body') { dansHead = false; bodyCommence = true }
    else if (nom === 'meta') {
      const name = (at.name || '').trim().toLowerCase()
      const prop = (at.property || '').trim().toLowerCase()
      const c = at.content
      if (c !== undefined) {
        if (name === 'description' && f.description === null) f.description = c.trim()
        else if (name === 'robots' && f.robots === null) f.robots = c.trim()
        else if (name === 'viewport' && f.viewport === null) f.viewport = c.trim()
        else if (name === 'author' && auteurMeta === null && c.trim()) auteurMeta = c.trim()
        else if (prop === 'og:title' && f.og.title === null) f.og.title = c.trim()
        else if (prop === 'og:description' && f.og.description === null) f.og.description = c.trim()
        else if (prop === 'og:image' && f.og.image === null) f.og.image = c.trim()
        else if (prop === 'og:site_name' && f.ogSiteName === null) f.ogSiteName = c.trim()
        else if (prop === 'article:published_time' && dateMeta.publiee === null && c.trim()) dateMeta.publiee = c.trim()
        else if (prop === 'article:modified_time' && dateMeta.modifiee === null && c.trim()) dateMeta.modifiee = c.trim()
      }
    } else if (nom === 'link') {
      const rels = (at.rel || '').toLowerCase().split(/\s+/)
      if (at.href !== undefined) {
        if (rels.includes('canonical') && f.canonical === null) f.canonical = at.href.trim()
        if (rels.includes('alternate') && at.hreflang !== undefined) f.hreflang.push({ lang: at.hreflang.trim(), href: at.href.trim() })
        if (rels.includes('prev') && f.rel.prev === null) f.rel.prev = at.href.trim()
        if (rels.includes('next') && f.rel.next === null) f.rel.next = at.href.trim()
      }
    } else if (/^h[1-6]$/.test(nom)) {
      fermerHn()
      flushLibre()
      fermerParagraphe()
      hn = { niveau: Number(nom[1]), texte: '', nosnippet: ns !== null }
    } else if (nom === 'a') {
      fermerLien()
      if (at.href !== undefined) {
        lien = { href: at.href.trim(), texte: '', auteur: (at.rel || '').toLowerCase().split(/\s+/).includes('author') }
      }
    } else if (nom === 'img') {
      f.images.push({
        src: at.src !== undefined ? at.src : null,
        alt: at.alt !== undefined ? at.alt : null,
        width: at.width !== undefined ? at.width : null,
        height: at.height !== undefined ? at.height : null,
      })
    } else if (nom === 'time') {
      if (tempsPremier === null && at.datetime !== undefined && at.datetime.trim()) tempsPremier = at.datetime.trim()
    } else if (nom === 'p') ouvrir('paragraphe')
    else if (nom === 'ul' || nom === 'ol') ouvrir('liste')
    else if (nom === 'table') ouvrir('tableau')
    else if (nom === 'dl') ouvrir('definition')
    else if (nom === 'li') { const s = trouver('liste'); if (s) { finirItem(s); s.cur = '' } }
    else if (nom === 'tr') { const s = trouver('tableau'); if (s) { finirLigne(s); s.row = [] } }
    else if (nom === 'td' || nom === 'th') {
      const s = trouver('tableau')
      if (s) { finirCellule(s); if (!s.row) s.row = []; s.cell = '' }
    } else if (nom === 'dt' || nom === 'dd') { const s = trouver('definition'); if (s) { finirItem(s); s.cur = '' } }
    else if (nom === 'br') texte(' ')
  }
  fermerHn()
  fermerLien()
  flushLibre()
  while (pile.length) fermer()
  f.blocs = f.blocs.filter((b) => b.texte)

  // Author, dates and snippet controls: meta first, then JSON-LD, then page markup.
  let auteurLd = null
  let publieeLd = null
  let modifieeLd = null
  for (const x of noeudsJsonld(f.jsonld)) {
    if (auteurLd === null) auteurLd = nomAuteur(x.author)
    if (publieeLd === null) publieeLd = premiereChaine(x.datePublished)
    if (modifieeLd === null) modifieeLd = premiereChaine(x.dateModified)
  }
  f.auteur = auteurMeta ?? auteurLd ?? auteurRel
  f.dates = { publiee: dateMeta.publiee ?? publieeLd ?? tempsPremier, modifiee: dateMeta.modifiee ?? modifieeLd }
  if (f.robots !== null) {
    f.nosnippet = /(^|[\s,])nosnippet(?=$|[\s,])/i.test(f.robots) || /max-snippet\s*:\s*0(?![\d.])/i.test(f.robots)
  }

  f.mots = compterMots(texteVisible)
  f.corpsVide = f.mots < 20
  return f
}

export function extraire(html, url) {
  const u = typeof url === 'string' ? url : null
  try { return analyser(typeof html === 'string' ? html : '', u) }
  catch { return vide(u) }
}
