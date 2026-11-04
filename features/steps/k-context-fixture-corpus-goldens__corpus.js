'use strict';

const { After, BeforeAll, Given, Then, When } = require('@cucumber/cucumber');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const check = require('./k-context-fixture-corpus-goldens__check.js');

const P = 'k-context-fixture-corpus-goldens: ';
const repoRoot = path.resolve(__dirname, '..', '..');
const targetDir = process.env.CARGO_TARGET_DIR
  ? path.resolve(repoRoot, process.env.CARGO_TARGET_DIR)
  : path.join(repoRoot, 'target');
const binary = path.join(targetDir, 'debug', 'kogen-context');
const buildCommand = ['cargo', 'build', '--locked', '--offline', '--bin', 'kogen-context'];
const goldens = 'tests/goldens';
const updateVariable = 'KOGEN_CONTEXT_UPDATE_GOLDENS';

BeforeAll({ timeout: 600000 }, function () {
  const r = spawnSync(buildCommand[0], buildCommand.slice(1), { cwd: repoRoot, encoding: 'utf8', timeout: 590000 });
  if (r.status !== 0) {
    throw new Error(
      `${buildCommand.join(' ')} failed in ${repoRoot} (status ${r.status}, signal ${r.signal}, error ${r.error}):\n${r.stdout}${r.stderr}`,
    );
  }
});

After(function () {
  if (this.kcfcg && this.kcfcg.temp) fs.rmSync(this.kcfcg.temp, { recursive: true, force: true });
});

function state(world) {
  if (!world.kcfcg) world.kcfcg = {};
  return world.kcfcg;
}

function fail(message) {
  throw new Error(message);
}

function expectEqual(actual, expected, message) {
  if (actual !== expected) fail(`${message}\nexpected: ${JSON.stringify(expected)}\nactual:   ${JSON.stringify(actual)}`);
}

function failOn(problems, what) {
  if (problems.length) fail(`${what}:\n${problems.join('\n')}`);
}

const abs = (rel) => path.join(repoRoot, rel);

function regularFile(rel) {
  const st = fs.lstatSync(abs(rel), { throwIfNoEntry: false });
  if (!st || !st.isFile()) fail(`${rel} is not a regular file in the repository`);
  return fs.readFileSync(abs(rel));
}

function goldenFile(name, kind) {
  return regularFile(`${goldens}/${name}.${kind}.json`);
}

function goldenPacket(name) {
  const rel = `${goldens}/${name}.packet.json`;
  try {
    return JSON.parse(goldenFile(name, 'packet').toString('utf8'));
  } catch (e) {
    return fail(`${rel} is not JSON (${e.message})`);
  }
}

// Same JSON value: object members in any order, arrays in order.
function sameJson(a, b) {
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => sameJson(v, b[i]));
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const ka = Object.keys(a).sort();
    const kb = Object.keys(b).sort();
    return sameJson(ka, kb) && ka.every((k) => sameJson(a[k], b[k]));
  }
  return a === b;
}

// Every entry under dir without following symlinks, sorted bytewise.
function walk(dir, rel = '') {
  const out = [];
  for (const name of fs.readdirSync(path.join(dir, rel))) {
    const r = rel ? `${rel}/${name}` : name;
    const st = fs.lstatSync(path.join(dir, r));
    out.push({ rel: r, st });
    if (st.isDirectory()) out.push(...walk(dir, r));
  }
  return out.sort((x, y) => check.bytewise(x.rel, y.rel));
}

function directory(rel) {
  const st = fs.lstatSync(abs(rel), { throwIfNoEntry: false });
  if (!st || !st.isDirectory()) fail(`${rel} is not a directory in the repository`);
  return abs(rel);
}

// Kind, mode, size, modification time, content hash and symlink target of
// every entry under dir, and of dir itself.
function snapshot(dir) {
  const describe = (full, st) => {
    let detail = '';
    if (st.isFile()) detail = crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex');
    else if (st.isSymbolicLink()) detail = fs.readlinkSync(full);
    const kind = st.isFile() ? 'file' : st.isDirectory() ? 'dir' : st.isSymbolicLink() ? 'symlink' : 'other';
    return `${kind} mode ${st.mode} size ${st.size} mtime ${st.mtimeMs} ${detail}`;
  };
  return [`. ${describe(dir, fs.lstatSync(dir))}`, ...walk(dir).map((e) => `${e.rel} ${describe(path.join(dir, e.rel), e.st)}`)];
}

function corpusListing(dir) {
  return walk(dir)
    .filter((e) => !e.st.isDirectory())
    .map((e) => {
      if (e.st.isFile()) return e.rel;
      if (e.st.isSymbolicLink()) return `${e.rel} -> ${fs.readlinkSync(path.join(dir, e.rel))}`;
      return `${e.rel} (not a regular file or symlink)`;
    });
}

function textLines(rel) {
  const text = check.decode(regularFile(rel));
  if (text === undefined) fail(`${rel} is not UTF-8 text`);
  return check.splitLines(text);
}

function copyTree(from, to, skip) {
  fs.mkdirSync(to, { recursive: true });
  for (const name of fs.readdirSync(from)) {
    const src = path.join(from, name);
    if (skip.has(src)) continue;
    const dest = path.join(to, name);
    const st = fs.lstatSync(src);
    if (st.isSymbolicLink()) fs.symlinkSync(fs.readlinkSync(src), dest);
    else if (st.isDirectory()) copyTree(src, dest, skip);
    else if (st.isFile()) fs.copyFileSync(src, dest);
  }
}

function copyRoot(world) {
  const s = state(world);
  if (!s.copy) fail('no copy of the repository has been made');
  return s.copy;
}

function copyFile(world, rel) {
  const file = path.join(copyRoot(world), rel);
  const st = fs.lstatSync(file, { throwIfNoEntry: false });
  if (!st || !st.isFile()) fail(`${rel} is not a regular file in the copy ${copyRoot(world)}`);
  return file;
}

function runInCopy(world, command, extraEnv) {
  const s = state(world);
  const args = command.split(' ');
  const env = { ...process.env, CARGO_TARGET_DIR: path.join(s.temp, 'target'), ...extraEnv };
  if (!extraEnv) delete env[updateVariable];
  const r = spawnSync(args[0], args.slice(1), { cwd: copyRoot(world), env, encoding: 'utf8', timeout: 590000 });
  s.command = {
    command,
    extraEnv,
    status: r.status,
    signal: r.signal,
    error: r.error ? String(r.error) : undefined,
    output: `${r.stdout}${r.stderr}`,
  };
}

function lastCommand(world) {
  const s = state(world);
  if (!s.command) fail('no command has run in the copy');
  const c = s.command;
  return {
    ...c,
    text: `command: ${c.command} in ${copyRoot(world)} with ${JSON.stringify(c.extraEnv || {})}\nexit status: ${c.status} (signal ${c.signal}, spawn error ${c.error})\noutput:\n${c.output}`,
  };
}

function runs(world) {
  const s = state(world);
  if (!s.runs) fail('kogen-context has not run on the golden requests');
  return s.runs;
}

const describeRun = (r) =>
  `request ${goldens}/${r.name}.request.json: exit status ${r.status} (signal ${r.signal}, spawn error ${r.error})\nstdout: ${JSON.stringify(r.stdout.toString('utf8'))}\nstderr: ${JSON.stringify(r.stderr.toString('utf8'))}`;

// The corpus

Then(P + 'the directory {string} holds exactly these regular files and symlinks:', function (rel, expected) {
  expectEqual(corpusListing(directory(rel)).join('\n'), expected, `${rel} does not hold exactly the expected files and symlinks`);
});

Then(P + 'the file {string} has exactly the content:', function (rel, expected) {
  expectEqual(regularFile(rel).toString('utf8'), `${expected}\n`, `${rel} does not have the expected content`);
});

Then(P + 'these symlinks resolve outside their checkout:', function (table) {
  for (const row of table.hashes()) {
    const link = abs(row.symlink);
    const st = fs.lstatSync(link, { throwIfNoEntry: false });
    if (!st || !st.isSymbolicLink()) fail(`${row.symlink} is not a symlink`);
    const resolved = fs.realpathSync(link);
    expectEqual(resolved, fs.realpathSync(abs(row['resolves to'])), `${row.symlink} does not resolve to ${row['resolves to']}`);
    const checkout = fs.realpathSync(directory(row.checkout));
    if (resolved === checkout || resolved.startsWith(`${checkout}${path.sep}`)) {
      fail(`${row.symlink} resolves to ${resolved}, inside its checkout ${row.checkout}`);
    }
  }
});

Then(P + 'the regular UTF-8 files of {string} hold between {int} and {int} lines in total', function (rel, low, high) {
  const dir = directory(rel);
  let total = 0;
  for (const e of walk(dir)) {
    if (!e.st.isFile()) continue;
    const text = check.decode(fs.readFileSync(path.join(dir, e.rel)));
    if (text !== undefined) total += check.splitLines(text).length;
  }
  if (total < low || total > high) fail(`the regular UTF-8 files of ${rel} hold ${total} lines, not between ${low} and ${high}`);
});

Then(P + 'the file {string} is not valid UTF-8 and contains the bytes of {string}', function (rel, literal) {
  const bytes = regularFile(rel);
  if (check.decode(bytes) !== undefined) fail(`${rel} is valid UTF-8 text`);
  if (!bytes.includes(Buffer.from(literal))) fail(`${rel} does not contain the bytes of ${JSON.stringify(literal)}`);
});

Then(P + 'the file {string} is UTF-8 text with at least {int} lines', function (rel, count) {
  const lines = textLines(rel);
  if (lines.length < count) fail(`${rel} has ${lines.length} lines, fewer than ${count}`);
});

Then(P + 'line {int} of the file {string} is longer than {int} characters and contains {string}', function (n, rel, count, literal) {
  const line = textLines(rel)[n - 1];
  if (line === undefined) fail(`${rel} has no line ${n}`);
  const length = Array.from(line).length;
  if (length <= count) fail(`line ${n} of ${rel} has ${length} characters, not more than ${count}`);
  if (!line.includes(literal)) fail(`line ${n} of ${rel} does not contain ${JSON.stringify(literal)}`);
});

Then(P + 'at least {int} lines of the file {string} contain {string}', function (count, rel, literal) {
  const found = textLines(rel).filter((line) => line.includes(literal)).length;
  if (found < count) fail(`${found} lines of ${rel} contain ${JSON.stringify(literal)}, fewer than ${count}`);
});

Then(P + 'the file {string} mentions {string}', function (rel, text) {
  if (!regularFile(rel).toString('utf8').includes(text)) fail(`${rel} does not mention ${JSON.stringify(text)}`);
});

// The goldens

Then(P + 'the directory {string} holds exactly the request and packet files of these goldens:', function (rel, table) {
  const expected = table
    .hashes()
    .flatMap((row) => [`${row.golden}.packet.json`, `${row.golden}.request.json`])
    .sort(check.bytewise);
  expectEqual(corpusListing(directory(rel)).join('\n'), expected.join('\n'), `${rel} does not hold exactly the golden files`);
});

Then(P + 'these golden requests hold exactly this JSON:', function (table) {
  for (const row of table.hashes()) {
    const rel = `${goldens}/${row.golden}.request.json`;
    let actual;
    try {
      actual = JSON.parse(goldenFile(row.golden, 'request').toString('utf8'));
    } catch (e) {
      fail(`${rel} is not JSON (${e.message})`);
    }
    if (!sameJson(actual, JSON.parse(row.request))) {
      fail(`${rel} differs from the expected request\nexpected: ${row.request}\nactual:   ${JSON.stringify(actual)}`);
    }
  }
});

Then(P + 'these golden packets are exactly:', function (table) {
  for (const row of table.hashes()) {
    expectEqual(JSON.stringify(JSON.parse(row.packet)), row.packet, `the expected packet of ${row.golden} is not compact JSON`);
    expectEqual(
      goldenFile(row.golden, 'packet').toString('utf8'),
      `${row.packet}\n`,
      `${goldens}/${row.golden}.packet.json is not exactly the expected packet line`,
    );
  }
});

When(P + 'I run kogen-context request on every golden request from the repository root, recording {string} around each run', function (corpus) {
  const dir = directory(corpus);
  const requests = fs
    .readdirSync(directory(goldens))
    .filter((name) => name.endsWith('.request.json'))
    .sort(check.bytewise);
  if (!requests.length) fail(`${goldens} holds no golden request`);
  state(this).runs = requests.map((file) => {
    const name = file.slice(0, -'.request.json'.length);
    const before = snapshot(dir);
    const r = spawnSync(binary, ['request'], { cwd: repoRoot, input: goldenFile(name, 'request'), timeout: 30000 });
    const after = snapshot(dir);
    return {
      name,
      status: r.status,
      signal: r.signal,
      error: r.error ? String(r.error) : undefined,
      stdout: r.stdout || Buffer.alloc(0),
      stderr: r.stderr || Buffer.alloc(0),
      before,
      after,
    };
  });
});

Then(P + 'each run printed exactly its golden packet on stdout and nothing on stderr', function () {
  const problems = [];
  for (const r of runs(this)) {
    const golden = goldenFile(r.name, 'packet');
    if (!r.stdout.equals(golden) || r.stderr.length) {
      problems.push(`${describeRun(r)}\ngolden ${goldens}/${r.name}.packet.json: ${JSON.stringify(golden.toString('utf8'))}`);
    }
  }
  failOn(problems, 'runs that did not print exactly their golden packet with empty stderr');
});

Then(
  P + 'each run exited with status 0 for a search or read packet, 2 for an error packet with code "invalid_request" or "unsupported_version" and 1 for any other error packet',
  function () {
    const problems = [];
    for (const r of runs(this)) {
      let packet;
      try {
        packet = JSON.parse(r.stdout.toString('utf8'));
      } catch {
        problems.push(`${describeRun(r)}\nstdout is not JSON`);
        continue;
      }
      const code = packet && packet.error ? packet.error.code : undefined;
      const expected = code === undefined ? 0 : code === 'invalid_request' || code === 'unsupported_version' ? 2 : 1;
      if (r.status !== expected) problems.push(`${describeRun(r)}\nexpected exit status ${expected}`);
    }
    failOn(problems, 'runs with an unexpected exit status');
  },
);

Then(P + 'every run left {string} unchanged', function (corpus) {
  const problems = [];
  for (const r of runs(this)) {
    const before = r.before.join('\n');
    const after = r.after.join('\n');
    if (before !== after) {
      const changed = [...new Set([...r.before, ...r.after])].filter((line) => !r.before.includes(line) || !r.after.includes(line));
      problems.push(`request ${goldens}/${r.name}.request.json changed ${corpus}:\n${changed.join('\n')}`);
    }
  }
  failOn(problems, `runs that changed ${corpus}`);
});

Then(
  P + 'the golden packet {string} is a search in {string} for {string} with max matches {int}, max line chars {int} and truncated {string}, each match being the line of its file',
  function (name, root, literal, maxMatches, maxLineChars, truncated) {
    const problems = check.searchProblems(abs(root), goldenPacket(name), {
      literal,
      maxMatches,
      maxLineChars,
      truncated: truncated === 'true',
    });
    failOn(problems, `${goldens}/${name}.packet.json`);
  },
);

Then(P + 'the golden packet {string} has exactly {int} matches', function (name, count) {
  expectEqual(goldenPacket(name).matches.length, count, `${goldens}/${name}.packet.json has another number of matches`);
});

Then(P + 'the golden packet {string} has a match in each of these files:', function (name, table) {
  const paths = goldenPacket(name).matches.map((m) => m.path);
  const missing = table.hashes().map((row) => row.file).filter((file) => !paths.includes(file));
  if (missing.length) fail(`${goldens}/${name}.packet.json has no match in ${missing.join(', ')}; its match paths: ${JSON.stringify(paths)}`);
});

Then(P + 'the golden packet {string} has no match in any of these paths:', function (name, table) {
  const paths = goldenPacket(name).matches.map((m) => m.path);
  const inside = (p, q) => p === q || p.startsWith(`${q}/`);
  const found = paths.filter((p) => table.hashes().some((row) => inside(p, row.path)));
  if (found.length) fail(`${goldens}/${name}.packet.json has matches in ${found.join(', ')}`);
});

Then(P + 'the golden packet {string} lists exactly the matches of {string} under {string}, with that prefix removed', function (name, full, prefix) {
  failOn(check.underProblems(goldenPacket(name), goldenPacket(full), prefix), `${goldens}/${name}.packet.json against ${full}`);
});

Then(P + 'the golden packet {string} lists the first {int} matches of {string} with their text cut to {int} characters', function (name, count, full, maxLineChars) {
  failOn(check.firstProblems(goldenPacket(name), goldenPacket(full), count, maxLineChars), `${goldens}/${name}.packet.json against ${full}`);
});

Then(
  P + 'the golden packet {string} holds lines {int} to {int} of {string} in {string} cut to {int} characters, with max lines {int}',
  function (name, start, end, rel, root, maxLineChars, maxLines) {
    failOn(check.readProblems(abs(root), goldenPacket(name), rel, start, end, maxLines, maxLineChars), `${goldens}/${name}.packet.json`);
  },
);

Then(P + 'no golden packet has a match path, match text or line text containing {string}', function (literal) {
  const problems = [];
  for (const file of fs.readdirSync(directory(goldens)).filter((f) => f.endsWith('.packet.json')).sort(check.bytewise)) {
    const packet = goldenPacket(file.slice(0, -'.packet.json'.length));
    for (const m of packet.matches || []) {
      if (`${m.path}\n${m.text}`.includes(literal)) problems.push(`${file}: match ${JSON.stringify(m)}`);
    }
    for (const l of packet.lines || []) {
      if (String(l.text).includes(literal)) problems.push(`${file}: line ${JSON.stringify(l)}`);
    }
  }
  failOn(problems, `golden packets containing ${JSON.stringify(literal)}`);
});

// The golden test and its update path, in a copy of the repository

Given(P + 'a copy of the repository without its Git directory and build output', function () {
  const s = state(this);
  s.temp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kogen-context-goldens-')));
  s.copy = path.join(s.temp, 'repo');
  copyTree(repoRoot, s.copy, new Set([abs('.git'), abs('target'), abs('.kogen/local'), targetDir]));
});

When(P + 'I replace {string} with {string} in the copy\'s {string}', function (from, to, rel) {
  const file = copyFile(this, rel);
  const text = fs.readFileSync(file, 'utf8');
  if (!text.includes(from)) fail(`${rel} in the copy does not contain ${JSON.stringify(from)}: ${JSON.stringify(text)}`);
  fs.writeFileSync(file, text.replace(from, to));
});

When(P + 'I delete the copy\'s {string}', function (rel) {
  fs.rmSync(copyFile(this, rel));
});

When(P + 'I run {string} in the copy', { timeout: 600000 }, function (command) {
  runInCopy(this, command);
});

When(P + 'I run {string} in the copy with {string} set to {string}', { timeout: 600000 }, function (command, name, value) {
  runInCopy(this, command, { [name]: value });
});

Then(P + 'the command fails and its output mentions {string}', function (text) {
  const c = lastCommand(this);
  if (c.status === 0) fail(`the command succeeded\n${c.text}`);
  if (!c.output.includes(text)) fail(`the output does not mention ${JSON.stringify(text)}\n${c.text}`);
});

Then(P + 'the command succeeds', function () {
  const c = lastCommand(this);
  expectEqual(c.status, 0, `the command failed\n${c.text}`);
});

Then(P + 'the copy\'s {string} is byte-identical to the repository\'s', function (rel) {
  const copied = fs.lstatSync(path.join(copyRoot(this), rel), { throwIfNoEntry: false });
  if (!copied || !copied.isFile()) fail(`${rel} is not a regular file in the copy ${copyRoot(this)}`);
  const actual = fs.readFileSync(path.join(copyRoot(this), rel));
  const expected = regularFile(rel);
  if (!actual.equals(expected)) {
    fail(`${rel} in the copy differs from the repository's\nexpected: ${JSON.stringify(expected.toString('utf8'))}\nactual:   ${JSON.stringify(actual.toString('utf8'))}`);
  }
});
