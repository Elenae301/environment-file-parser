/**
 * Parses .env file contents according to a single, documented dialect.
 *
 * Design decisions (stated so the tests and the reader share one mind):
 *
 *  1. A line whose key collides with an earlier key is silently ignored. This
 *     mirrors the behaviour of shell `source` on redefinition and keeps the
 *     parser side-effect free. Callers who want duplicates to error can check
 *     the returned key order themselves.
 *
 *  2. Variable expansion uses the already-parsed environment ONLY. We never
 *     read process.env at parse time: doing so would couple a pure function to
 *     global mutable state and make tests non-deterministic. Callers who want
 *     the real environment merged in can spread it before the call.
 *
 *  3. ${VAR} and $VAR are both supported, but NOT inside single-quoted values.
 *     Single quotes mean literal. This is the one ambiguity people trip on, so
 *     it is stated here and tested below.
 *
 *  4. Comments are only recognised at the start of a line (after optional
 *     leading whitespace) or after a value's closing quote. `FOO=bar#baz` is
 *     the value `bar#baz`, not `bar` plus a comment. This is the common shell
 *     rule and avoids needing to know which characters are "safe" mid-value.
 *
 *  5. Only \n and \r\n are line terminators. The old Mac \r-only form is not
 *     supported; it is vanishingly rare and supporting it makes error messages
 *     worse for everyone else.
 */

/**
 * @typedef {Object} ParseOptions
 * @property {boolean} [expand=true] Whether to perform $VAR / ${VAR}
 *   expansion inside unquoted and double-quoted values. Single-quoted values
 *   are never expanded regardless of this flag.
 */

/**
 * Parses a .env file string into a flat object.
 *
 * @param {string} input The raw file contents.
 * @param {ParseOptions} [options]
 * @returns {Record<string, string>} A plain object mapping keys to values,
 *   in the order they were first defined.
 */
export function parse(input, options) {
  if (typeof input !== 'string') {
    throw new TypeError(`parse() expected a string, got ${typeof input}`);
  }
  const expand = options ? options.expand !== false : true;

  /** @type {Record<string, string>} */
  const result = {};
  const lines = splitLines(input);

  for (const line of lines) {
    const parsed = parseLine(line);
    if (parsed === null) continue;
    const { key, rawValue, quote } = parsed;
    if (Object.prototype.hasOwnProperty.call(result, key)) continue;

    const shouldExpand = expand && quote !== "'";
    result[key] = shouldExpand
      ? expandValue(rawValue, result)
      : rawValue;
  }
  return result;
}

/**
 * Parses a single logical line into a key/value/quote triple, or returns null
 * for blank lines and comment lines.
 *
 * Exposed publicly so callers can build streaming parsers or inspect a line
 * without committing to the expansion policy of `parse`.
 *
 * @param {string} line A single line with no trailing newline.
 * @returns {{key: string, rawValue: string, quote: '"' | "'" | ''} | null}
 *   `rawValue` is the value AFTER escape processing but BEFORE variable
 *   expansion. `quote` is the empty string for unquoted values.
 */
export function parseLine(line) {
  // Strip a leading `export ` prefix. We only do this at the start of the line
  // (after whitespace) so that `export=1` still defines a variable literally
  // named `export`.
  let s = line.replace(/^[ \t\f\v]*export[ \t\f\v]+/, '');

  if (/^[ \t\f\v]*#/.test(s) || /^[ \t\f\v]*$/.test(s)) {
    return null;
  }

  const eq = s.indexOf('=');
  if (eq === -1) {
    throw new Error(`Missing '=' in line: ${line}`);
  }

  const key = s.slice(0, eq).trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
    throw new Error(`Invalid key '${key}' in line: ${line}`);
  }

  let rest = s.slice(eq + 1);

  // Leading whitespace around the value is insignificant. Trailing whitespace
  // for unquoted values is also stripped (it would otherwise be ambiguous
  // with a trailing comment). For quoted values the closing quote governs.
  rest = rest.replace(/^[ \t\f\v]*/, '');

  const ch = rest[0];
  if (ch === '"' || ch === "'") {
    const { value, endIndex } = consumeQuoted(rest, ch);
    let after = rest.slice(endIndex);
    // Anything after the closing quote must be whitespace or a comment.
    const afterTrim = after.replace(/^[ \t\f\v]*/, '');
    if (afterTrim && !afterTrim.startsWith('#')) {
      throw new Error(`Unexpected trailing content after quote in line: ${line}`);
    }
    return { key, rawValue: value, quote: ch };
  }

  // Unquoted: value runs to end of line or to a `#` preceded by whitespace.
  // A `#` NOT preceded by whitespace is part of the value (see decision #4).
  const hashMatch = rest.match(/(^|[ \t\f\v])#.*/);
  let unquoted = hashMatch ? rest.slice(0, hashMatch.index + hashMatch[1].length) : rest;
  unquoted = unquoted.replace(/[ \t\f\v]+$/, '');
  // No escape processing for unquoted values: backslashes are literal.
  // Rationale: shells do not process escapes in unquoted context either,
  // and inventing a partial escape grammar here would surprise users.
  return { key, rawValue: unquoted, quote: '' };
}

/**
 * Splits input into lines, tolerating \n, \r\n, and a trailing newline.
 * @param {string} input
 * @returns {string[]}
 */
function splitLines(input) {
  if (input.length === 0) return [];
  const parts = input.split(/\r?\n/);
  // A trailing newline produces a final empty element; drop it so it is not
  // treated as a (harmless but noisy) blank line.
  if (parts.length > 0 && parts[parts.length - 1] === '') {
    parts.pop();
  }
  return parts;
}

/**
 * Consumes a quoted string starting at rest[0] === quote, returning the
 * unescaped value and the index one past the closing quote.
 *
 * Escape rules (double-quote only; single-quote is literal):
 *   \\  -> backslash
 *   \"  -> double quote
 *   \n  -> newline
 *   \r  -> carriage return
 *   \t  -> tab
 *   Any other \X -> \X literally (backslash preserved).
 *
 * @param {string} rest
 * @param {string} quote
 * @returns {{value: string, endIndex: number}}
 */
function consumeQuoted(rest, quote) {
  let out = '';
  let i = 1;
  while (i < rest.length) {
    const c = rest[i];
    if (c === '\\') {
      if (quote === '"') {
        const next = rest[i + 1];
        if (next === 'n') out += '\n';
        else if (next === 'r') out += '\r';
        else if (next === 't') out += '\t';
        else if (next === '"' || next === '\\') out += next;
        else out += c + (next ?? '');
        i += 2;
        continue;
      }
      // Single-quoted: backslashes are literal characters.
      out += c;
      i += 1;
      continue;
    }
    if (c === quote) {
      return { value: out, endIndex: i + 1 };
    }
    out += c;
    i += 1;
  }
  throw new Error(`Unterminated quote in line: ${rest}`);
}

/**
 * Expands $VAR and ${VAR} references using only the given environment.
 * Unknown variables expand to the empty string (bash `set -u` is off by
 * default; callers who want strictness can post-process).
 *
 * @param {string} value
 * @param {Record<string, string>} env
 * @returns {string}
 */
function expandValue(value, env) {
  let out = '';
  let i = 0;
  while (i < value.length) {
    const c = value[i];
    if (c !== '$') {
      out += c;
      i += 1;
      continue;
    }
    const next = value[i + 1];
    if (next === '{') {
      const close = value.indexOf('}', i + 2);
      if (close === -1) {
        // Unterminated ${: treat the rest of the string literally rather than
        // throw. This keeps expansion total and lets callers see the mistake.
        out += value.slice(i);
        break;
      }
      const name = value.slice(i + 2, close);
      out += lookup(name, env);
      i = close + 1;
      continue;
    }
    if (next && /[A-Za-z_]/.test(next)) {
      let j = i + 1;
      while (j < value.length && /[A-Za-z0-9_]/.test(value[j])) j += 1;
      const name = value.slice(i + 1, j);
      out += lookup(name, env);
      i = j;
      continue;
    }
    // Lone $ or $ followed by non-identifier: literal.
    out += '$';
    i += 1;
  }
  return out;
}

/**
 * Looks up a name in env, tolerating inherited Object.prototype properties by
 * using hasOwnProperty. This is why we do not write `env[name] ?? ''`.
 */
function lookup(name, env) {
  if (Object.prototype.hasOwnProperty.call(env, name)) {
    return String(env[name]);
  }
  return '';
}
