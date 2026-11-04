'use strict';

// Checks of golden packets against the corpus files they were produced from.
// The Feasibility observer controls run them as a command:
//   node k-context-fixture-corpus-goldens__check.js search ROOT LITERAL MAX_MATCHES MAX_LINE_CHARS TRUNCATED PACKET
//   node k-context-fixture-corpus-goldens__check.js read ROOT PATH START END MAX_LINES MAX_LINE_CHARS PACKET
//   node k-context-fixture-corpus-goldens__check.js first LIMITED_PACKET COUNT MAX_LINE_CHARS FULL_PACKET
// where each PACKET is JSON text. It prints "ok" and exits 0, or prints each
// problem and exits 1.

const fs = require('node:fs');
const path = require('node:path');

const utf8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

// Lines as kogen-context splits them: on "\n", without a "\r" right before
// it and without an extra line after a final "\n".
function splitLines(content) {
  if (content === '') return [];
  const parts = content.split('\n');
  const ended = content.endsWith('\n');
  if (ended) parts.pop();
  return parts.map((line, i) => ((i < parts.length - 1 || ended) && line.endsWith('\r') ? line.slice(0, -1) : line));
}

const chars = (s) => Array.from(s);
const clip = (line, max) => chars(line).slice(0, max).join('');

// 1-based character column of the first occurrence, or 0.
function columnOf(line, literal) {
  const i = line.indexOf(literal);
  return i < 0 ? 0 : chars(line.slice(0, i)).length + 1;
}

const bytewise = (a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b));

function decode(buffer) {
  try {
    return utf8.decode(buffer);
  } catch {
    return undefined;
  }
}

// Lines of the regular UTF-8 file at the repo-relative path rel under root,
// reached without passing through any symlink.
function fileLines(root, rel) {
  if (typeof rel !== 'string' || rel.split('/').some((p) => p === '' || p === '.' || p === '..')) {
    throw new Error(`${JSON.stringify(rel)} is not a normalized relative path`);
  }
  let at = root;
  for (const part of rel.split('/')) {
    at = path.join(at, part);
    const st = fs.lstatSync(at, { throwIfNoEntry: false });
    if (!st) throw new Error(`${rel} does not exist under ${root}`);
    if (st.isSymbolicLink()) throw new Error(`${rel} goes through the symlink ${path.relative(root, at)} under ${root}`);
  }
  if (!fs.lstatSync(at).isFile()) throw new Error(`${rel} is not a regular file under ${root}`);
  const text = decode(fs.readFileSync(at));
  if (text === undefined) throw new Error(`${rel} under ${root} is not UTF-8 text`);
  return splitLines(text);
}

const keysOf = (value) => (value && typeof value === 'object' && !Array.isArray(value) ? Object.keys(value) : []);
const json = JSON.stringify;

function membersProblem(what, value, keys) {
  return json(keysOf(value)) === json(keys) ? [] : [`${what} has the members ${json(keysOf(value))}, not ${json(keys)}`];
}

// A search packet over root: its framing, and each match being the first
// occurrence of the literal in its file's line, in path then line order.
function searchProblems(root, packet, { literal, maxMatches, maxLineChars, truncated }) {
  const problems = membersProblem('the packet', packet, ['version', 'operation', 'query', 'matches', 'truncated', 'limits']);
  if (problems.length) return problems;
  if (packet.version !== 1) problems.push(`version is ${json(packet.version)}, not 1`);
  if (packet.operation !== 'search') problems.push(`operation is ${json(packet.operation)}, not "search"`);
  if (packet.query !== literal) problems.push(`query is ${json(packet.query)}, not ${json(literal)}`);
  if (packet.truncated !== truncated) problems.push(`truncated is ${json(packet.truncated)}, not ${truncated}`);
  const limits = { max_matches: maxMatches, max_line_chars: maxLineChars };
  if (json(packet.limits) !== json(limits)) problems.push(`limits are ${json(packet.limits)}, not ${json(limits)}`);
  if (!Array.isArray(packet.matches)) return [...problems, 'matches is not an array'];
  if (packet.matches.length > maxMatches) problems.push(`${packet.matches.length} matches exceed max matches ${maxMatches}`);
  if (truncated && packet.matches.length !== maxMatches) {
    problems.push(`truncated with ${packet.matches.length} matches instead of max matches ${maxMatches}`);
  }
  packet.matches.forEach((m, i) => {
    const where = `match ${i + 1} (${json(m && m.path)} line ${json(m && m.line)})`;
    const shape = membersProblem(where, m, ['path', 'line', 'column', 'text']);
    if (shape.length) {
      problems.push(...shape);
      return;
    }
    let lines;
    try {
      lines = fileLines(root, m.path);
    } catch (e) {
      problems.push(`${where}: ${e.message}`);
      return;
    }
    if (!Number.isInteger(m.line) || m.line < 1 || m.line > lines.length) {
      problems.push(`${where}: the file has ${lines.length} lines`);
      return;
    }
    const line = lines[m.line - 1];
    const column = columnOf(line, literal);
    if (column === 0) problems.push(`${where}: the line does not contain ${json(literal)}`);
    else if (m.column !== column) problems.push(`${where}: column ${json(m.column)} is not the first occurrence ${column}`);
    const text = clip(line, maxLineChars);
    if (m.text !== text) problems.push(`${where}: text ${json(m.text)} is not the line cut to ${maxLineChars} characters ${json(text)}`);
    const before = packet.matches[i - 1];
    if (before && typeof before.path === 'string') {
      const order = bytewise(before.path, m.path);
      if (order > 0 || (order === 0 && before.line >= m.line)) problems.push(`${where}: not after match ${i} in path then line order`);
    }
  });
  return problems;
}

// A read packet: exactly lines start..end of root/rel cut to maxLineChars.
function readProblems(root, packet, rel, start, end, maxLines, maxLineChars) {
  let lines;
  try {
    lines = fileLines(root, rel);
  } catch (e) {
    return [e.message];
  }
  if (end > lines.length) return [`${rel} has ${lines.length} lines, fewer than line ${end}`];
  const expected = {
    version: 1,
    operation: 'read',
    path: rel,
    start,
    end,
    total_lines: lines.length,
    lines: lines.slice(start - 1, end).map((text, i) => ({ line: start + i, text: clip(text, maxLineChars) })),
    limits: { max_lines: maxLines, max_line_chars: maxLineChars },
  };
  const problems = membersProblem('the packet', packet, Object.keys(expected));
  if (problems.length) return problems;
  for (const key of Object.keys(expected)) {
    if (key === 'lines' && Array.isArray(packet.lines)) {
      const count = Math.max(expected.lines.length, packet.lines.length);
      for (let i = 0; i < count; i += 1) {
        if (json(packet.lines[i]) !== json(expected.lines[i])) {
          problems.push(`lines[${i}]: expected ${json(expected.lines[i])}, actual ${json(packet.lines[i])}`);
        }
      }
    } else if (json(packet[key]) !== json(expected[key])) {
      problems.push(`${key}: expected ${json(expected[key])}, actual ${json(packet[key])}`);
    }
  }
  return problems;
}

// The matches of limited are the first count matches of full with their text
// cut to maxLineChars, and limited is truncated exactly when full has more.
function firstProblems(limited, full, count, maxLineChars) {
  if (!Array.isArray(limited.matches) || !Array.isArray(full.matches)) return ['a packet has no matches array'];
  if (full.truncated !== false) return ['the full packet is truncated, so its first matches are not known to be complete'];
  const expected = full.matches.slice(0, count).map((m) => ({ ...m, text: clip(m.text, maxLineChars) }));
  const problems = [];
  const n = Math.max(expected.length, limited.matches.length);
  for (let i = 0; i < n; i += 1) {
    if (json(limited.matches[i]) !== json(expected[i])) {
      problems.push(`match ${i + 1}: expected ${json(expected[i])}, actual ${json(limited.matches[i])}`);
    }
  }
  const truncated = full.matches.length > count;
  if (limited.truncated !== truncated) problems.push(`truncated is ${json(limited.truncated)}, not ${truncated}`);
  return problems;
}

// The matches of nested are exactly the matches of full under prefix, with
// prefix removed from their paths.
function underProblems(nested, full, prefix) {
  if (!Array.isArray(nested.matches) || !Array.isArray(full.matches)) return ['a packet has no matches array'];
  if (full.truncated !== false) return ['the full packet is truncated, so its matches are not known to be complete'];
  const expected = full.matches
    .filter((m) => m.path.startsWith(prefix))
    .map((m) => ({ ...m, path: m.path.slice(prefix.length) }));
  const problems = [];
  const n = Math.max(expected.length, nested.matches.length);
  for (let i = 0; i < n; i += 1) {
    if (json(nested.matches[i]) !== json(expected[i])) {
      problems.push(`match ${i + 1}: expected ${json(expected[i])}, actual ${json(nested.matches[i])}`);
    }
  }
  if (nested.truncated !== false) problems.push(`truncated is ${json(nested.truncated)}, not false`);
  return problems;
}

module.exports = { bytewise, clip, decode, fileLines, firstProblems, readProblems, searchProblems, splitLines, underProblems };

if (require.main === module) {
  const [mode, ...a] = process.argv.slice(2);
  let problems;
  if (mode === 'search' && a.length === 6) {
    problems = searchProblems(a[0], JSON.parse(a[5]), {
      literal: a[1],
      maxMatches: Number(a[2]),
      maxLineChars: Number(a[3]),
      truncated: a[4] === 'true',
    });
  } else if (mode === 'read' && a.length === 7) {
    problems = readProblems(a[0], JSON.parse(a[6]), a[1], Number(a[2]), Number(a[3]), Number(a[4]), Number(a[5]));
  } else if (mode === 'first' && a.length === 4) {
    problems = firstProblems(JSON.parse(a[0]), JSON.parse(a[3]), Number(a[1]), Number(a[2]));
  } else {
    process.stderr.write('usage: search ROOT LITERAL MAX_MATCHES MAX_LINE_CHARS TRUNCATED PACKET | read ROOT PATH START END MAX_LINES MAX_LINE_CHARS PACKET | first LIMITED COUNT MAX_LINE_CHARS FULL\n');
    process.exit(2);
  }
  process.stdout.write(problems.length ? `${problems.join('\n')}\n` : 'ok\n');
  process.exitCode = problems.length ? 1 : 0;
}
