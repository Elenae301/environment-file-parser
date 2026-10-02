# Environment File Parser

A tiny, zero-dependency parser for `.env` files. Exports two functions from `src/index.js`:

```js
import { parse, parseLine } from './src/index.js';

const env = parse('GREETING=hi\nMSG="${GREETING} there"');
// => { GREETING: 'hi', MSG: 'hi there' }

const pieces = parseLine('export KEY="value"');
// => { key: 'KEY', rawValue: 'value', quote: '"' }
```

`parse(input, options?)` returns a plain object mapping keys to values in first-definition order. `options.expand` (default `true`) toggles `$VAR` / `${VAR}` expansion. `parseLine(line)` returns `{ key, rawValue, quote }` or `null` for blank/comment lines; `rawValue` is the value after escape processing but before expansion, and `quote` is `"`, `'`, or the empty string so callers can apply their own expansion policy.

## Why

The Node ecosystem has several `.env` parsers; most pull in a graph of dependencies and read `process.env` as a side effect of parsing. This library exists for the opposite case: a single file with no imports beyond the standard library, and a parser that is a pure function of its input. The trade-off is that callers who want the real OS environment merged in must do so themselves — `Object.assign({}, process.env, parse(text))`.

## Edge you will hit

Single-quoted values are **literal**: no `$VAR` expansion and no backslash escapes happen inside them, ever. `'$HOME'` stays the six characters `$HOME`. Double-quoted values expand variables and process the escapes `\n`, `\r`, `\t`, `\\`, and `\"`. Unquoted values have no escape processing at all — a backslash is just a backslash — but do expand variables.

A `#` begins a comment only at the start of a line or when preceded by whitespace within an unquoted value. `URL=https://host/path#frag` is the literal string including `#frag`, because `#` is not preceded by whitespace.

Duplicate keys are silently kept as first-defined; this matches shell `source` semantics and keeps the parser side-effect free.
