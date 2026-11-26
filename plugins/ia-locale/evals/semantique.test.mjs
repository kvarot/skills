import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertLoopback, chunkText, planRefresh, normalize, rrf, chunkTexts } from '../outils/semantique.mjs';

test('assertLoopback accepts local URLs', () => {
  assert.strictEqual(assertLoopback('http://127.0.0.1:11434'), 'http://127.0.0.1:11434');
  assert.strictEqual(assertLoopback('http://localhost:11434'), 'http://localhost:11434');
  assert.strictEqual(assertLoopback('http://[::1]:11434'), 'http://[::1]:11434');
  assert.throws(() => assertLoopback('http://192.168.1.10:11434'));
  assert.throws(() => assertLoopback('https://api.example.com'));
  assert.throws(() => assertLoopback('not a url'));
});

test('chunkText produces expected content', () => {
  const txt = chunkText('src/a.go', 'package a\n\nimport "fmt"\n\nfunc Hello() {}\n', ['Hello']);
  assert.ok(txt.startsWith('search_document: src/a.go'));
  assert.ok(txt.includes('symbols: Hello'));
  assert.ok(txt.includes('func Hello'));
  assert.ok(!txt.includes('import'));
  assert.ok(!txt.includes('package a'));
});

test('chunkText respects car limit', () => {
  const src = 'a'.repeat(10000);
  const txt = chunkText('p', src, [], { car: 500 });
  assert.ok(txt.length <= 500);
});

test('planRefresh identifies changed files', () => {
  const res = planRefresh([{path:'a',key:'1'},{path:'b',key:'2'}], [{path:'a',key:'1'},{path:'b',key:'3'},{path:'c',key:'4'}]);
  assert.deepEqual(res, ['b','c']);
});

test('normalize produces unit vector', () => {
  const v = normalize([3,4]);
  assert.ok(Math.abs(v[0]-0.6) < 1e-6);
  assert.ok(Math.abs(v[1]-0.8) < 1e-6);
});

test('rrf ranks correctly', () => {
  const res1 = rrf([['a','b','c'],['c','a']]);
  assert.strictEqual(res1[0][0], 'a');
  res1.forEach(([,score]) => assert.ok(score > 0));
  const res2 = rrf([['x'],['y']], [1,2]);
  assert.strictEqual(res2[0][0], 'y');
});

test('chunkTexts splits into windows', () => {
  const src1 = 'a1\nb2\nc3\nd4\ne5';
  const res1 = chunkTexts('p', src1, [], { fenetres: 3, lignes: 2 });
  assert.strictEqual(res1.length, 3);
  assert.ok(res1[2].includes('e5'));
  const src2 = 'a1\nb2';
  const res2 = chunkTexts('p', src2, [], { fenetres: 3, lignes: 2 });
  assert.strictEqual(res2.length, 1);
});
