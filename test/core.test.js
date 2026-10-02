import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse, parseLine } from '../src/index.js';

test('empty input yields empty object', () => {
  assert.deepEqual(parse(''), {});
});

test('simple key=value', () => {
  assert.deepEqual(parse('FOO=bar'), { FOO: 'bar' });
});

test('blank lines and comment lines are skipped', () => {
  const out = parse('# a comment\n\n   # indented comment\nKEY=val\n');
  assert.deepEqual(out, { KEY: 'val' });
});

test('export prefix is stripped', () => {
  assert.deepEqual(parse('export FOO=1'), { FOO: '1' });
});

test('duplicate keys keep the first definition', () => {
  assert.deepEqual(parse('A=1\nA=2'), { A: '1' });
});

test('double quotes preserve inner whitespace', () => {
  assert.deepEqual(parse('X="  hi  "'), { X: '  hi  ' });
});

test('single quotes are literal: no expansion, no escapes', () => {
  const out = parse("NAME='${USER}'\nESC='\\\"'");
  assert.deepEqual(out, { NAME: '${USER}', ESC: '\\"' });
});

test('double-quote escape sequences are processed', () => {
  assert.deepEqual(
    parse('A="line1\\nline2\\t\\\"done\\\""'),
    { A: 'line1\nline2\t"done"' },
  );
});

test('expansion uses previously defined keys only', () => {
  const out = parse('GREETING=hello\nMSG="${GREETING} world"\nALSO=$GREETING!');
  assert.deepEqual(out, {
    GREETING: 'hello',
    MSG: 'hello world',
    ALSO: 'hello!',
  });
});

test('undefined variable expands to empty string', () => {
  assert.deepEqual(parse('X="[${NOPE}]"'), { X: '[]' });
});

test('hash inside value is literal when not preceded by whitespace', () => {
  assert.deepEqual(parse('URL=https://host/path#frag'), {
    URL: 'https://host/path#frag',
  });
});

test('inline comment after value requires preceding whitespace', () => {
  assert.deepEqual(parse('A=1   # trailing\nB=2#notcomment'), { A: '1', B: '2#notcomment' });
});

test('expansion can be disabled', () => {
  assert.deepEqual(parse('X=$Y', { expand: false }), { X: '$Y' });
});

test('parseLine returns null for blank and comment lines', () => {
  assert.equal(parseLine('   '), null);
  assert.equal(parseLine('# x'), null);
});

test('parseLine reports the quote so callers can choose expansion policy', () => {
  assert.deepEqual(parseLine('A=1'), { key: 'A', rawValue: '1', quote: '' });
  assert.deepEqual(parseLine('A="1"'), { key: 'A', rawValue: '1', quote: '"' });
  assert.deepEqual(parseLine("A='1'"), { key: 'A', rawValue: '1', quote: "'" });
});

test('invalid key throws', () => {
  assert.throws(() => parseLine('123=x'), /Invalid key/);
});

test('missing equals throws', () => {
  assert.throws(() => parseLine('FOO'), /Missing/);
});

test('unterminated quote throws', () => {
  assert.throws(() => parseLine('A="oops'), /Unterminated/);
});

test('CRLF line endings are handled', () => {
  assert.deepEqual(parse('A=1\r\nB=2\r\n'), { A: '1', B: '2' });
});

test('trailing content after closing quote throws', () => {
  assert.throws(() => parseLine('A="1"junk'), /trailing content/);
});

test('lone dollar sign is literal', () => {
  assert.deepEqual(parse('COST=10$'), { COST: '10$' });
});

test('unquoted value is stripped of trailing whitespace before comment', () => {
  assert.deepEqual(parse('A=hi   # c'), { A: 'hi' });
});
