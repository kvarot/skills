import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { analyserRobots, evaluerRobotsIa } from '../../outils/lib/robots.mjs'

const registre = JSON.parse(readFileSync(new URL('../../donnees/robots.json', import.meta.url), 'utf8'))

test('groupes : le groupe nommé l’emporte sur *, jetons insensibles à la casse', () => {
  const r = analyserRobots('User-agent: *\nDisallow: /\n\nUser-agent: gptbot\nUser-agent: ClaudeBot\nAllow: /\n')
  assert.equal(r.autorise('GPTBot', '/x'), true)
  assert.equal(r.autorise('OAI-SearchBot', '/x'), false)
  assert.equal(r.groupeApplique('ClaudeBot'), 'specifique')
  assert.equal(r.groupeApplique('OAI-SearchBot'), 'etoile')
  assert.equal(r.groupeApplique('CCBot'), 'etoile')
})

test('groupes : deux groupes du même agent sont fusionnés', () => {
  const r = analyserRobots('User-agent: GPTBot\nDisallow: /a\n\nUser-agent: Other\nDisallow: /\n\nUser-agent: GPTBOT\nDisallow: /b\n')
  assert.equal(r.autorise('GPTBot', '/a/1'), false)
  assert.equal(r.autorise('GPTBot', '/b/1'), false)
  assert.equal(r.autorise('GPTBot', '/c'), true)
  assert.equal(r.groupes.length, 3)
})

test('règle la plus longue gagne, Allow gagne à égalité, $ et *', () => {
  const r = analyserRobots('User-agent: *\nDisallow: /prive\nAllow: /prive/ok\nDisallow: /t$\nDisallow: /*.pdf$\nDisallow: /e\nAllow: /e\n')
  assert.equal(r.autorise('X', '/prive/ok/1'), true)
  assert.equal(r.autorise('X', '/prive/no'), false)
  assert.equal(r.autorise('X', '/t'), false)
  assert.equal(r.autorise('X', '/t/x'), true)
  assert.equal(r.autorise('X', '/doc/a.pdf'), false)
  assert.equal(r.autorise('X', '/doc/a.pdf?x=1'), true)
  assert.equal(r.autorise('X', '/e'), true)
})

test('Disallow: /prive$ ne bloque pas /prive/x', () => {
  const r = analyserRobots('User-agent: *\nDisallow: /prive$\n')
  assert.equal(r.autorise('X', '/prive'), false)
  assert.equal(r.autorise('X', '/prive/x'), true)
})

test('robots.txt absent : tout autorisé, aucun groupe', () => {
  const r = analyserRobots(null)
  assert.equal(r.autorise('GPTBot', '/x'), true)
  assert.equal(r.groupeApplique('GPTBot'), 'aucun')
  assert.deepEqual(r.groupes, [])
  assert.equal(r.contentSignal, null)
  assert.deepEqual(r.sitemaps, [])
})

test('Disallow vide : tout autorisé ; groupe sans règle', () => {
  const r = analyserRobots('User-agent: *\nDisallow: /\n\nUser-agent: GPTBot\nDisallow:\n\nUser-agent: CCBot\n')
  assert.equal(r.autorise('GPTBot', '/x'), true)
  assert.equal(r.autorise('CCBot', '/x'), true)
  assert.equal(r.groupeApplique('CCBot'), 'specifique')
  assert.equal(r.autorise('ClaudeBot', '/x'), false)
})

test('Allow: / contre Disallow: / à égalité : Allow gagne', () => {
  const r = analyserRobots('User-agent: *\nDisallow: /\nAllow: /\n')
  assert.equal(r.autorise('X', '/a'), true)
})

test('commentaires, CRLF, BOM, lignes avant tout User-agent ignorées', () => {
  const txt = '﻿Disallow: /orphelin\r\n# commentaire\r\nUser-agent: GPTBot # robot\r\nDisallow: /secret # note\r\n'
  const r = analyserRobots(txt)
  assert.equal(r.autorise('GPTBot', '/secret/a'), false)
  assert.equal(r.autorise('GPTBot', '/orphelin'), true)
  assert.equal(r.groupes.length, 1)
})

test('pourcentage-encodage : formes équivalentes', () => {
  const r = analyserRobots('User-agent: *\nDisallow: /caf%C3%A9\nDisallow: /a%7Eb\nDisallow: /m%c3%A9\n')
  assert.equal(r.autorise('X', '/café/x'), false)
  assert.equal(r.autorise('X', '/caf%c3%a9'), false)
  assert.equal(r.autorise('X', '/a~b'), false)
  assert.equal(r.autorise('X', '/mé'), false)
})

test('Content-Signal brut et Sitemap globaux', () => {
  const r = analyserRobots('Sitemap: https://a.example/s.xml\nUser-agent: *\nContent-Signal: search=yes, ai-train=no\nAllow: /\nSitemap: https://a.example/t.xml\n')
  assert.equal(r.contentSignal, 'search=yes, ai-train=no')
  assert.deepEqual(r.sitemaps, ['https://a.example/s.xml', 'https://a.example/t.xml'])
})

test('evaluerRobotsIa : verdict par robot du registre', () => {
  const txt = 'User-agent: GPTBot\nDisallow: /\n\nUser-agent: *\nDisallow: /prive\n'
  const res = evaluerRobotsIa(txt, ['/', '/prive/a'], registre)
  const g = res.find((x) => x.jeton === 'GPTBot')
  assert.deepEqual(g.chemins_bloques, ['/', '/prive/a'])
  assert.equal(g.groupe, 'specifique')
  assert.equal(g.role, 'entrainement')
  assert.equal(g.documente, true)
  const c = res.find((x) => x.jeton === 'ClaudeBot')
  assert.deepEqual(c.chemins_bloques, ['/prive/a'])
  assert.equal(c.groupe, 'etoile')
  assert.equal(res.length, registre.robots.length)
  assert.equal(evaluerRobotsIa(null, ['/'], registre.robots)[0].groupe, 'aucun')
})

test('registre : validité et jetons attendus', () => {
  assert.equal(registre.version, '2026-11-27')
  const roles = ['entrainement', 'indexation', 'consultation-utilisateur', 'controle', 'autre']
  const stances = ['oui', 'non', 'partiel', 'inconnu']
  const vus = new Set()
  for (const e of registre.robots) {
    assert.ok(roles.includes(e.role), e.jeton)
    assert.ok(stances.includes(e.respecte_robots), e.jeton)
    assert.match(e.verifie_le, /^\d{4}-\d{2}-\d{2}$/)
    assert.ok(e.editeur)
    if (e.documente) assert.match(e.source, /^https:\/\//, e.jeton)
    else { assert.equal(e.source, null); assert.equal(e.respecte_robots, 'inconnu'); assert.equal(e.verification, null) }
    const k = e.jeton.toLowerCase()
    assert.ok(!vus.has(k), `doublon ${e.jeton}`)
    vus.add(k)
  }
  for (const j of ['GPTBot', 'OAI-SearchBot', 'ChatGPT-User', 'ClaudeBot', 'Claude-SearchBot', 'Claude-User', 'Googlebot', 'Google-Extended', 'PerplexityBot', 'Perplexity-User', 'bingbot', 'Applebot-Extended', 'CCBot', 'MistralAI-User']) {
    assert.ok(vus.has(j.toLowerCase()), j)
  }
  for (const j of ['GrokBot', 'DeepSeekBot']) assert.equal(registre.robots.find((e) => e.jeton === j).documente, false)
  assert.equal(registre.robots.find((e) => e.jeton === 'Google-Extended').role, 'controle')
})
