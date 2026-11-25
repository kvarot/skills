// Extracts SEO facts from an HTML string with a small tag tokenizer (no DOM, no deps).
// extraire(html, url) -> Faits. Never throws: on any failure it returns empty facts.

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
// Elements allowed in <head>; any other start tag implicitly begins the body.
const HEAD_OK = new Set(['html', 'head', 'title', 'meta', 'link', 'base', 'script', 'style', 'noscript', 'template'])

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
    jsonld: [], mots: 0, corpsVide: true,
  }
}

function compterMots(texte) {
  let n = 0
  for (const t of texte.split(/\s+/)) if (/[\p{L}\p{N}]/u.test(t)) n++
  return n
}

function analyser(html, url) {
  const f = vide(url)
  let pos = 0
  let dansHead = false
  let bodyCommence = false
  let svg = 0
  let hn = null // { niveau, texte }
  let lien = null // { href, texte }
  let texteVisible = ''
  const n = html.length

  const texte = (t) => {
    if (hn) hn.texte += t
    if (lien) lien.texte += t
    if (!dansHead) texteVisible += ' ' + t
  }
  const fermerHn = () => { if (hn) { f.hn.push({ niveau: hn.niveau, texte: nettoyer(hn.texte) }); hn = null } }
  const fermerLien = () => { if (lien) { f.liens.push({ href: lien.href, texte: nettoyer(lien.texte) }); lien = null } }

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
      continue
    }
    if (!suite || !/[A-Za-z]/.test(suite)) { texte('<'); pos = lt + 1; continue }

    const fin = finTag(html, lt + 1)
    const corps = html.slice(lt + 1, fin === -1 ? n : fin)
    pos = fin === -1 ? n : fin + 1
    const m = /^([A-Za-z][A-Za-z0-9:-]*)([\s\S]*)$/.exec(corps)
    const nom = m[1].toLowerCase()
    const at = attributs(m[2])

    if (!HEAD_OK.has(nom)) { dansHead = false; bodyCommence = true }
    if (nom === 'svg' && !corps.endsWith('/')) svg++
    if (RAW.has(nom) && !corps.endsWith('/')) {
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
        else if (prop === 'og:title' && f.og.title === null) f.og.title = c.trim()
        else if (prop === 'og:description' && f.og.description === null) f.og.description = c.trim()
        else if (prop === 'og:image' && f.og.image === null) f.og.image = c.trim()
      }
    } else if (nom === 'link') {
      const rels = (at.rel || '').toLowerCase().split(/\s+/)
      if (at.href !== undefined) {
        if (rels.includes('canonical') && f.canonical === null) f.canonical = at.href.trim()
        if (rels.includes('alternate') && at.hreflang !== undefined) f.hreflang.push({ lang: at.hreflang.trim(), href: at.href.trim() })
      }
    } else if (/^h[1-6]$/.test(nom)) {
      fermerHn()
      hn = { niveau: Number(nom[1]), texte: '' }
    } else if (nom === 'a') {
      fermerLien()
      if (at.href !== undefined) lien = { href: at.href.trim(), texte: '' }
    } else if (nom === 'img') {
      f.images.push({
        src: at.src !== undefined ? at.src : null,
        alt: at.alt !== undefined ? at.alt : null,
        width: at.width !== undefined ? at.width : null,
        height: at.height !== undefined ? at.height : null,
      })
    }
  }
  fermerHn()
  fermerLien()
  f.mots = compterMots(texteVisible)
  f.corpsVide = f.mots < 20
  return f
}

export function extraire(html, url) {
  const u = typeof url === 'string' ? url : null
  try { return analyser(typeof html === 'string' ? html : '', u) }
  catch { return vide(u) }
}
