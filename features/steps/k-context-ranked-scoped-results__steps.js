'use strict';

const { After, BeforeAll, Given, Then, When } = require('@cucumber/cucumber');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { traced } = require('./k-context-ranked-scoped-results__trace.js');

const P = 'k-context-ranked-scoped-results: ';
const repoRoot = path.resolve(__dirname, '..', '..');
const targetDir = process.env.CARGO_TARGET_DIR
  ? path.resolve(repoRoot, process.env.CARGO_TARGET_DIR)
  : path.join(repoRoot, 'target');
const binary = path.join(targetDir, 'debug', 'kogen-context');
const buildCommand = ['cargo', 'build', '--locked', '--offline', '--bin', 'kogen-context'];
const replayStepMs = 1800000;

BeforeAll({ timeout: 600000 }, function () {
  const r = spawnSync(buildCommand[0], buildCommand.slice(1), {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout: 590000,
  });
  if (r.status !== 0) {
    throw new Error(
      `${buildCommand.join(' ')} failed in ${repoRoot} (status ${r.status}, signal ${r.signal}, error ${r.error}):\n${r.stdout}${r.stderr}`,
    );
  }
});

After(function () {
  for (const dir of [this.krsParent, this.krsReplayTmp]) {
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
});

const bytewise = (a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b));

// Lines as kogen-context splits them: on \n, without a \r before it and
// without an extra line after a final \n.
function splitLines(content) {
  const parts = content.split('\n');
  if (parts[parts.length - 1] === '') parts.pop();
  return parts.map((line, i) => (i < parts.length - 1 || content.endsWith('\n') ? line.replace(/\r$/, '') : line));
}

const clip = (line, max) => Array.from(line).slice(0, max).join('');

function parent(world) {
  if (!world.krsParent) {
    world.krsParent = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kogen-context-ranked-')));
  }
  return world.krsParent;
}

function writeFile(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

// Every entry under dir (symlinks recorded, never followed), sorted bytewise,
// leaving out the top-level names in skip.
function snapshot(dir, skip = []) {
  const out = [];
  const walk = (abs, rel) => {
    for (const name of fs.readdirSync(abs).sort(bytewise)) {
      if (!rel && skip.includes(name)) continue;
      const a = path.join(abs, name);
      const r = rel ? `${rel}/${name}` : name;
      const st = fs.lstatSync(a);
      if (st.isSymbolicLink()) out.push(`link ${r} -> ${fs.readlinkSync(a)}`);
      else if (st.isDirectory()) {
        out.push(`dir ${r}`);
        walk(a, r);
      } else {
        const hash = crypto.createHash('sha256').update(fs.readFileSync(a)).digest('hex');
        out.push(`file ${r} ${st.size} ${st.mtimeMs} ${hash}`);
      }
    }
  };
  walk(dir, '');
  return out;
}

function snapshotDiff(before, after) {
  const a = new Set(before);
  const b = new Set(after);
  return [...before.filter((x) => !b.has(x)).map((x) => `- ${x}`), ...after.filter((x) => !a.has(x)).map((x) => `+ ${x}`)];
}

function lastRun(world) {
  const runs = world.krsRuns || [];
  assert.ok(runs.length > 0, 'no kogen-context request has run in this scenario');
  return runs[runs.length - 1];
}

function request(world, cwd, input) {
  const r = spawnSync(binary, ['request'], { cwd, input, encoding: 'utf8', timeout: 120000 });
  if (r.error) throw new Error(`cannot run ${binary} request: ${r.error.message}`);
  (world.krsRuns = world.krsRuns || []).push({ cwd, input, status: r.status, stdout: r.stdout, stderr: r.stderr });
}

function describe(run) {
  return `request ${run.input.trim()} from ${run.cwd}: exit ${run.status}, stdout ${JSON.stringify(run.stdout)}, stderr ${JSON.stringify(run.stderr)}`;
}

Given(P + 'a checkout {string} with these files:', function (name, table) {
  for (const row of table.hashes()) {
    writeFile(path.join(parent(this), name, row.path), row.content.replace(/\\t/g, '\t'));
  }
});

Given(P + 'the checkout {string} has the file {string} with the bytes {string}', function (name, rel, hex) {
  writeFile(path.join(parent(this), name, rel), Buffer.from(hex.replace(/ /g, ''), 'hex'));
});

Given(P + 'the file {string} beside the checkouts holds the line {string}', function (rel, text) {
  writeFile(path.join(parent(this), rel), `${text}\n`);
});

Given(P + 'the checkout {string} has a symlink {string} to {string}', function (name, rel, target) {
  const link = path.join(parent(this), name, rel);
  fs.mkdirSync(path.dirname(link), { recursive: true });
  fs.symlinkSync(target, link);
});

Given(P + 'a checkout {string} with the files of {string} written in reverse order', function (name, from) {
  const source = path.join(parent(this), from);
  const entries = [];
  const walk = (abs, rel) => {
    for (const n of fs.readdirSync(abs).sort(bytewise)) {
      const a = path.join(abs, n);
      const r = rel ? `${rel}/${n}` : n;
      const st = fs.lstatSync(a);
      if (st.isDirectory()) walk(a, r);
      else entries.push({ rel: r, link: st.isSymbolicLink() ? fs.readlinkSync(a) : null, bytes: st.isSymbolicLink() ? null : fs.readFileSync(a) });
    }
  };
  walk(source, '');
  assert.ok(entries.length > 0, `the checkout ${from} has no files`);
  for (const e of entries.reverse()) {
    const target = path.join(parent(this), name, e.rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    if (e.link !== null) fs.symlinkSync(e.link, target);
    else fs.writeFileSync(target, e.bytes);
  }
});

Given(P + 'I record the directory {string} of the repository', function (dir) {
  (this.krsRecorded = this.krsRecorded || {})[dir] = snapshot(path.join(repoRoot, dir));
});

When(P + 'I send this request to kogen-context request from the directory of the checkouts:', function (doc) {
  request(this, parent(this), doc);
});

When(P + 'I send this request to kogen-context request from the repository root:', function (doc) {
  request(this, repoRoot, doc);
});

When(P + 'I send this request to kogen-context request from the repository root under strace:', function (doc) {
  const root = path.resolve(repoRoot, JSON.parse(doc).root);
  const r = traced(root, doc, binary, ['request'], repoRoot);
  (this.krsRuns = this.krsRuns || []).push({
    cwd: repoRoot,
    input: doc,
    status: r.status,
    stdout: String(r.stdout),
    stderr: String(r.stderr),
    problems: r.problems,
  });
});

Then(P + 'the command exits with status {int} and prints nothing on stderr', function (status) {
  const run = lastRun(this);
  assert.equal(run.status, status, describe(run));
  assert.equal(run.stderr, '', describe(run));
});

Then(P + 'the packet is exactly:', function (doc) {
  const run = lastRun(this);
  assert.equal(run.stdout, `${doc}\n`, describe(run));
});

Then(P + 'the packet is exactly the file {string} of the repository', function (rel) {
  const run = lastRun(this);
  assert.equal(run.stdout, fs.readFileSync(path.join(repoRoot, rel), 'utf8'), describe(run));
});

Then(
  P + 'the packet is a search for {string} with max matches {int}, max line chars {int} and truncated {string}, listing exactly these matches of {string}:',
  function (query, maxMatches, maxChars, truncated, root, table) {
    const run = lastRun(this);
    const rootDir = path.resolve(run.cwd, root);
    const matches = table.hashes().map((row) => {
      const lines = splitLines(fs.readFileSync(path.join(rootDir, row.path), 'utf8'));
      const line = Number(row.line);
      assert.ok(line >= 1 && line <= lines.length, `${root}/${row.path} has no line ${row.line}`);
      return { path: row.path, line, column: Number(row.column), text: clip(lines[line - 1], maxChars) };
    });
    const expected = {
      version: 1,
      operation: 'search',
      query,
      matches,
      truncated: truncated === 'true',
      limits: { max_matches: maxMatches, max_line_chars: maxChars },
    };
    const want = `${JSON.stringify(expected)}\n`;
    if (run.stdout === want) return;
    let listed = '(stdout is not a search packet)';
    try {
      const actual = JSON.parse(run.stdout);
      listed = (actual.matches || []).map((m, i) => `  ${i + 1}. ${m.path}:${m.line}:${m.column}`).join('\n');
    } catch {
      // keep the default
    }
    const wanted = matches.map((m, i) => `  ${i + 1}. ${m.path}:${m.line}:${m.column}`).join('\n');
    assert.fail(`${describe(run)}\nexpected matches (path:line:column):\n${wanted}\nactual matches:\n${listed}\nexpected packet:\n${want}`);
  },
);

Then(P + 'the last two packets are byte-identical', function () {
  const runs = this.krsRuns || [];
  assert.ok(runs.length >= 2, 'fewer than two requests ran in this scenario');
  const [a, b] = runs.slice(-2);
  assert.equal(b.stdout, a.stdout, `${describe(a)}\n${describe(b)}`);
});

Then(
  P + 'the packet lists the first {int} matches of the first packet of this scenario, with max matches {int} and truncated {string}',
  function (count, maxMatches, truncated) {
    const runs = this.krsRuns || [];
    assert.ok(runs.length >= 2, 'fewer than two requests ran in this scenario');
    const first = JSON.parse(runs[0].stdout);
    const run = lastRun(this);
    const expected = { ...first, matches: first.matches.slice(0, count), truncated: truncated === 'true', limits: { ...first.limits, max_matches: maxMatches } };
    assert.ok(first.matches.length >= count, `the first packet has only ${first.matches.length} matches`);
    assert.equal(run.stdout, `${JSON.stringify(expected)}\n`, describe(run));
  },
);

Then(P + 'no match of the packet is in any of these paths:', function (table) {
  const run = lastRun(this);
  const packet = JSON.parse(run.stdout);
  for (const { path: p } of table.hashes()) {
    const hit = packet.matches.find((m) => m.path === p || m.path.startsWith(`${p}/`));
    assert.ok(!hit, `match in ${p}: ${JSON.stringify(hit)}`);
  }
});

Then(P + 'the run made no network call, ran no other program, opened nothing for writing and opened nothing outside its root', function () {
  const run = lastRun(this);
  assert.ok(run.problems, 'the last request did not run under strace');
  assert.deepEqual(run.problems, [], `${describe(run)}\nstrace showed:\n${run.problems.join('\n')}`);
});

Then(P + 'the directory {string} of the repository is unchanged', function (dir) {
  const before = (this.krsRecorded || {})[dir];
  assert.ok(before, `the directory ${dir} was not recorded`);
  assert.deepEqual(snapshotDiff(before, snapshot(path.join(repoRoot, dir))), [], `${dir} changed`);
});

Then(P + 'the directory {string} of the repository holds exactly these files:', function (dir, doc) {
  const actual = snapshot(path.join(repoRoot, dir))
    .filter((e) => !e.startsWith('dir '))
    .map((e) => (e.startsWith('link ') ? e.slice(5) : e.slice(5).split(' ')[0]));
  assert.deepEqual(actual, doc.split('\n').filter((l) => l !== ''), `files under ${dir}`);
});

Then(P + 'the file {string} of the repository holds exactly:', function (rel, doc) {
  const file = path.join(repoRoot, rel);
  assert.ok(fs.existsSync(file), `${rel} does not exist`);
  assert.equal(fs.readFileSync(file, 'utf8'), `${doc}\n`, rel);
});

Then(P + 'the file {string} of the repository holds JSON:', function (rel, doc) {
  const file = path.join(repoRoot, rel);
  assert.ok(fs.existsSync(file), `${rel} does not exist`);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), JSON.parse(doc), rel);
});

Then(P + 'the file {string} of the repository mentions {string}', function (rel, text) {
  const file = path.join(repoRoot, rel);
  assert.ok(fs.existsSync(file), `${rel} does not exist`);
  assert.ok(fs.readFileSync(file, 'utf8').includes(text), `${rel} does not mention ${text}`);
});

Then(P + 'these golden requests in {string} hold exactly this JSON:', function (dir, table) {
  for (const row of table.hashes()) {
    const rel = `${dir}/${row.golden}.request.json`;
    const file = path.join(repoRoot, rel);
    assert.ok(fs.existsSync(file), `${rel} does not exist`);
    assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), JSON.parse(row.request), rel);
  }
});

Then(
  P + 'each golden packet in {string} is exactly what kogen-context request prints for its request from the repository root, with exit status 0 and nothing on stderr',
  function (dir) {
    const names = fs.readdirSync(path.join(repoRoot, dir)).filter((n) => n.endsWith('.request.json')).sort(bytewise);
    assert.ok(names.length > 0, `no golden requests in ${dir}`);
    for (const name of names) {
      const rel = `${dir}/${name}`;
      const packetRel = rel.replace(/\.request\.json$/, '.packet.json');
      const input = fs.readFileSync(path.join(repoRoot, rel));
      const r = spawnSync(binary, ['request'], { cwd: repoRoot, input, encoding: 'utf8', timeout: 120000 });
      assert.equal(r.status, 0, `${rel}: exit ${r.status}, stderr ${r.stderr}`);
      assert.equal(r.stderr, '', `${rel}: stderr`);
      assert.ok(fs.existsSync(path.join(repoRoot, packetRel)), `${packetRel} does not exist`);
      assert.equal(fs.readFileSync(path.join(repoRoot, packetRel), 'utf8'), r.stdout, `${packetRel} is not the output for ${rel}`);
    }
  },
);

Then(P + 'no file of the repository outside {string} has a name ending in {string}', function (dir, suffix) {
  const found = snapshot(repoRoot, ['.git', 'target'])
    .filter((e) => e.startsWith('file '))
    .map((e) => e.slice(5).split(' ')[0])
    .filter((rel) => rel.endsWith(suffix) && !rel.startsWith(dir));
  assert.deepEqual(found, [], `files ending in ${suffix} outside ${dir}`);
});

// The Crane replay script.

function runScript(world, script, args, env) {
  const r = spawnSync('sh', [script, ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
    env,
    timeout: replayStepMs - 60000,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (r.error) throw new Error(`cannot run sh ${script}: ${r.error.message}`);
  world.krsScript = { script, status: r.status, signal: r.signal, stdout: r.stdout, stderr: r.stderr };
}

function scriptRun(world) {
  assert.ok(world.krsScript, 'the replay script has not run in this scenario');
  return world.krsScript;
}

const RECORD = /^([0-9a-f]{11})\t(path|ranked)\t([^\t]+)\t([1-9][0-9]*)\t([^\t]+):([1-9][0-9]*)$/;

function records(world) {
  const run = scriptRun(world);
  return run.stdout
    .split('\n')
    .filter((l) => l !== '')
    .map((l) => {
      const m = RECORD.exec(l);
      assert.ok(m, `not a rank record: ${JSON.stringify(l)}`);
      return { revision: m[1], order: m[2], hint: m[3], rank: Number(m[4]), path: m[5], line: Number(m[6]) };
    });
}

When(P + 'I run {string} with no arguments', function (script) {
  runScript(this, script, [], process.env);
});

When(P + 'I run {string} with the built kogen-context and a new temporary directory as TMPDIR', { timeout: replayStepMs }, function (script) {
  this.krsReplayTmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kogen-context-replay-')));
  const skip = ['.git', 'target', '.kogen'];
  this.krsRepoBefore = snapshot(repoRoot, skip);
  runScript(this, script, [binary], { ...process.env, TMPDIR: this.krsReplayTmp });
  this.krsRepoAfter = snapshot(repoRoot, skip);
});

Then(P + 'it exits with status {int}, prints nothing on stdout and prints exactly this on stderr:', function (status, doc) {
  const run = scriptRun(this);
  assert.equal(run.status, status, `sh ${run.script}: exit ${run.status}, stderr ${JSON.stringify(run.stderr)}`);
  assert.equal(run.stdout, '', `sh ${run.script}: stdout`);
  assert.equal(run.stderr, `${doc}\n`, `sh ${run.script}: stderr`);
});

Then(P + 'the replay exits with status 0 and its temporary directory is empty again', function () {
  const run = scriptRun(this);
  assert.equal(run.status, 0, `sh ${run.script}: exit ${run.status}, signal ${run.signal}, stderr:\n${run.stderr}\nstdout (last 2000 bytes):\n${run.stdout.slice(-2000)}`);
  assert.deepEqual(fs.readdirSync(this.krsReplayTmp), [], `TMPDIR ${this.krsReplayTmp} after the replay`);
});

Then(P + 'every line the replay prints is a tab-separated rank record of revision, order, hint, rank and path:line', function () {
  const run = scriptRun(this);
  assert.ok(run.stdout.endsWith('\n'), 'the replay output does not end with a newline');
  assert.ok(records(this).length > 0, 'the replay printed no records');
});

Then(
  P + 'the replay records, in this order, for each revision and hint the path records and then the ranked records, numbered 1 to this many:',
  function (table) {
    const expected = [];
    for (const row of table.hashes()) {
      for (const order of ['path', 'ranked']) {
        for (let rank = 1; rank <= Number(row.records); rank += 1) expected.push(`${row.revision}\t${order}\t${row.hint}\t${rank}`);
      }
    }
    const actual = records(this).map((r) => `${r.revision}\t${r.order}\t${r.hint}\t${r.rank}`);
    assert.deepEqual(actual, expected, 'replay records (revision, order, hint, rank) in output order');
  },
);

Then(P + 'the replay ranks these owning lines:', function (table) {
  const recs = records(this);
  const problems = [];
  for (const row of table.hashes()) {
    for (const order of ['path', 'ranked']) {
      const want = row[`${order} order`];
      const hit = recs.find((r) => r.revision === row.revision && r.hint === row.hint && r.order === order && `${r.path}:${r.line}` === row.line);
      const got = hit ? 'listed' : 'not listed';
      if (got !== want) {
        problems.push(`${row.revision} ${row.hint} ${row.line}: ${order} order: expected ${want}, got ${got}${hit ? ` at rank ${hit.rank}` : ''}`);
      }
    }
  }
  assert.deepEqual(problems, [], 'owning lines in the replay records');
});

Then(P + 'every {string} record of {string} names a file ending in {string}', function (order, hint, suffix) {
  const recs = records(this).filter((r) => r.order === order && r.hint === hint);
  assert.ok(recs.length > 0, `no ${order} records of ${hint}`);
  const bad = recs.filter((r) => !r.path.endsWith(suffix)).map((r) => `${r.revision} rank ${r.rank}: ${r.path}:${r.line}`);
  assert.deepEqual(bad, [], `${order} records of ${hint} not ending in ${suffix}`);
});

Then(P + 'the replay left the repository unchanged', function () {
  assert.deepEqual(snapshotDiff(this.krsRepoBefore, this.krsRepoAfter), [], 'repository entries changed by the replay');
});
