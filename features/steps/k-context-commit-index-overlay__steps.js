'use strict';

// Steps of the Intent k-context-commit-index-overlay. They run the release
// binary of kogen-context on temporary Git checkouts with a temporary cache
// directory, compare every output with the output of the same search on a
// plain copy of the checkout without Git (which has no index), check that no
// search changes a checkout, and time kogen-context against ripgrep.

const { After, BeforeAll, Given, Then, When } = require('@cucumber/cucumber');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { changes, inode, record } = require('./k-context-commit-index-overlay__tree.js');

const P = 'k-context-commit-index-overlay: ';
const repoRoot = path.resolve(__dirname, '..', '..');
const targetDir = process.env.CARGO_TARGET_DIR
  ? path.resolve(repoRoot, process.env.CARGO_TARGET_DIR)
  : path.join(repoRoot, 'target');
const binary = path.join(targetDir, 'release', 'kogen-context');
const buildCommand = ['cargo', 'build', '--release', '--locked', '--offline', '--bin', 'kogen-context'];
const homeCache = process.platform === 'darwin' ? 'Library/Caches' : '.cache';
const RG_OPTIONS = [
  '--sort', 'path', '--fixed-strings', '--line-number', '--column', '--no-heading', '--no-ignore', '--hidden',
  '--glob', '!.git', '--no-messages',
];
// Aged files get this whole-second modification time (2020-01-01T00:00:00Z),
// so that an edit can restore it exactly.
const AGED_SECONDS = 1577836800;
// How long after its last change a file counts as older than the index's
// 2-second window.
const AGE_WAIT_MS = 3000;
const RUNS = 11;
const ORDERS = ['path', 'ranked'];
const CRANE_SCRIPT = 'scripts/crane-bench.sh';
// Runs every ignored test of the repository, which is the benchmark test.
const BENCH_COMMAND = ['cargo', 'test', '--release', '--locked', '--offline', '--', '--ignored', '--nocapture'];

const bytewise = (a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b));
const unescape = (s) => s.replace(/\\n/g, '\n').replace(/\\t/g, '\t');
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Math.max(0, ms));

BeforeAll({ timeout: 600000 }, function () {
  const r = spawnSync(buildCommand[0], buildCommand.slice(1), { cwd: repoRoot, encoding: 'utf8', timeout: 590000 });
  if (r.status !== 0) {
    throw new Error(
      `${buildCommand.join(' ')} failed in ${repoRoot} (status ${r.status}, signal ${r.signal}, error ${r.error}):\n${r.stdout}${r.stderr}`,
    );
  }
});

After(function () {
  const s = this.kci;
  if (!s) return;
  for (const dir of [s.dir, s.plainBase]) fs.rmSync(dir, { recursive: true, force: true });
});

// The nearest directory at or above dir that holds a .git entry, or null.
function gitAncestor(dir) {
  for (let d = dir; ; d = path.dirname(d)) {
    if (fs.existsSync(path.join(d, '.git'))) return d;
    if (path.dirname(d) === d) return null;
  }
}

function scenario(world) {
  if (!world.kci) {
    const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kci-')));
    const plainBase = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kci-plain-')));
    for (const d of [dir, plainBase]) {
      const git = gitAncestor(d);
      assert.equal(git, null, `the temporary directory ${d} is inside the Git checkout ${git}; set TMPDIR outside every checkout`);
    }
    fs.mkdirSync(path.join(dir, 'home'));
    world.kci = {
      dir,
      plainBase,
      plainCount: 0,
      checkouts: [],
      settings: { XDG_CACHE_HOME: path.join(dir, 'cache'), HOME: path.join(dir, 'home') },
      runs: [],
      previousCommits: {},
      noted: {},
      timings: [],
      script: null,
    };
  }
  return world.kci;
}

// The environment without Git, cache and home variables.
function cleanEnv() {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (!k.startsWith('GIT_') && k !== 'XDG_CACHE_HOME' && k !== 'HOME') env[k] = v;
  }
  return env;
}

function kogenEnv(s) {
  const env = cleanEnv();
  for (const [k, v] of Object.entries(s.settings)) if (v !== null) env[k] = v;
  return env;
}

function git(s, cwd, args) {
  const env = {
    ...cleanEnv(),
    HOME: path.join(s.dir, 'home'),
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_AUTHOR_NAME: 'Kogen',
    GIT_AUTHOR_EMAIL: 'kogen@example.invalid',
    GIT_AUTHOR_DATE: '2020-01-01T00:00:00Z',
    GIT_COMMITTER_NAME: 'Kogen',
    GIT_COMMITTER_EMAIL: 'kogen@example.invalid',
    GIT_COMMITTER_DATE: '2020-01-01T00:00:00Z',
  };
  const all = ['-c', 'core.autocrlf=false', '-c', 'commit.gpgsign=false', '-c', 'init.defaultBranch=main', ...args];
  const r = spawnSync('git', all, { cwd, env, encoding: 'utf8', maxBuffer: 64 << 20 });
  if (r.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed in ${cwd} (status ${r.status}, error ${r.error}): ${r.stdout}${r.stderr}`);
  }
  return r.stdout;
}

function writeFile(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

// Copies src to dst with symlinks as symlinks, leaving out every entry named .git.
function copyTree(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const name of fs.readdirSync(src)) {
    if (name === '.git') continue;
    const from = path.join(src, name);
    const to = path.join(dst, name);
    const st = fs.lstatSync(from);
    if (st.isSymbolicLink()) fs.symlinkSync(fs.readlinkSync(from), to);
    else if (st.isDirectory()) copyTree(from, to);
    else if (st.isFile()) {
      fs.copyFileSync(from, to);
      fs.chmodSync(to, st.mode & 0o777);
    }
  }
}

// Calls visit with every regular file under dir, outside directories named .git.
function eachFile(dir, visit) {
  for (const name of fs.readdirSync(dir)) {
    const abs = path.join(dir, name);
    const st = fs.lstatSync(abs);
    if (st.isDirectory()) {
      if (name !== '.git') eachFile(abs, visit);
    } else if (st.isFile()) visit(abs);
  }
}

function newCheckout(s, name) {
  assert.ok(!s.checkouts.includes(name), `the checkout ${name} exists already`);
  const dir = path.join(s.dir, name);
  fs.mkdirSync(dir, { recursive: true });
  s.checkouts.push(name);
  return dir;
}

function commitAll(s, dir, message) {
  git(s, dir, ['add', '-A']);
  git(s, dir, ['commit', '-q', '-m', message]);
}

function head(s, name) {
  return git(s, path.join(s.dir, name), ['rev-parse', 'HEAD']).trim();
}

// FNV-1a 64-bit of the bytes, as 16 lowercase hexadecimal digits.
function fnv1a64(bytes) {
  let h = 0xcbf29ce484222325n;
  for (const b of bytes) {
    h ^= BigInt(b);
    h = (h * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return h.toString(16).padStart(16, '0');
}

function expand(s, text) {
  return text
    .replace(/<previous commit of ([^>]+)>/g, (_, name) => {
      assert.ok(s.previousCommits[name], `no commit of ${name} was made in this scenario`);
      return s.previousCommits[name];
    })
    .replace(/<commit of ([^>]+)>/g, (_, name) => head(s, name))
    .replace(/<key of ([^>]+)>/g, (_, root) => fnv1a64(Buffer.from(fs.realpathSync(path.join(s.dir, root)))))
    .replace(/<home cache>/g, homeCache)
    .replace(/<scenario>/g, s.dir);
}

function checkoutOf(s, root) {
  const top = root.split('/')[0];
  assert.ok(s.checkouts.includes(top), `${root} is not in a checkout of this scenario (${s.checkouts.join(', ')})`);
  return top;
}

function requestInput(root, literal, order) {
  return `${JSON.stringify({ version: 1, root, operation: 'search', literal, order })}\n`;
}

function runSync(cwd, env, kind, root, literal, order) {
  const args = kind === 'request' ? ['request'] : ['search', root, literal];
  const input = kind === 'request' ? requestInput(root, literal, order) : '';
  const r = spawnSync(binary, args, { cwd, env, input, timeout: 300000, maxBuffer: 64 << 20 });
  if (r.error) throw new Error(`cannot run ${binary} ${args.join(' ')}: ${r.error.message}`);
  return { status: r.status, signal: r.signal, stdout: r.stdout, stderr: r.stderr };
}

function startRequest(cwd, env, root, literal, order) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, ['request'], { cwd, env });
    const out = [];
    const err = [];
    child.stdout.on('data', (d) => out.push(d));
    child.stderr.on('data', (d) => err.push(d));
    child.on('error', reject);
    child.on('close', (status, signal) => resolve({ status, signal, stdout: Buffer.concat(out), stderr: Buffer.concat(err) }));
    child.stdin.end(requestInput(root, literal, order));
  });
}

// The outputs of the searches on a fresh plain copy of the checkout top,
// without any .git entry, run with a cache directory that must stay absent.
function plainOutputs(s, top, searches) {
  s.plainCount += 1;
  const base = path.join(s.plainBase, String(s.plainCount));
  const cache = `${base}-cache`;
  const home = `${base}-home`;
  copyTree(path.join(s.dir, top), path.join(base, top));
  const env = { ...cleanEnv(), XDG_CACHE_HOME: cache, HOME: home };
  const outputs = searches.map((q) => runSync(base, env, q.kind, q.root, q.literal, q.order));
  for (const d of [cache, home]) {
    assert.ok(!fs.existsSync(d), `the search on the plain copy ${base} created ${d}: the plain copy must be searched without an index`);
  }
  fs.rmSync(base, { recursive: true, force: true });
  return outputs;
}

function recordCheckouts(s) {
  return new Map(s.checkouts.map((name) => [name, record(path.join(s.dir, name))]));
}

function checkoutChanges(s, before) {
  const out = [];
  for (const name of s.checkouts) {
    const after = record(path.join(s.dir, name));
    for (const p of changes(before.get(name) || new Map(), after)) out.push(`${name}: ${p}`);
  }
  return out;
}

function search(world, kind, root, literal, order) {
  const s = scenario(world);
  const top = checkoutOf(s, root);
  const before = recordCheckouts(s);
  const run = runSync(s.dir, kogenEnv(s), kind, root, literal, order);
  const changed = checkoutChanges(s, before);
  const [plain] = plainOutputs(s, top, [{ kind, root, literal, order }]);
  s.runs.push({ kind, root, literal, order, ...run, plain, changed });
}

function describeRun(run, n) {
  const what = run.kind === 'request' ? `request ${requestInput(run.root, run.literal, run.order).trim()}` : `kogen-context search ${run.root} ${run.literal}`;
  return `search ${n} (${what}): exit ${run.status}, signal ${run.signal}, stdout ${JSON.stringify(String(run.stdout))}, stderr ${JSON.stringify(String(run.stderr))}`;
}

function filesOutsideCheckouts(s) {
  const out = [];
  const walk = (abs, rel) => {
    for (const name of fs.readdirSync(abs)) {
      if (!rel && s.checkouts.includes(name)) continue;
      const a = path.join(abs, name);
      const r = rel ? `${rel}/${name}` : name;
      if (fs.lstatSync(a).isDirectory()) walk(a, r);
      else out.push(r);
    }
  };
  walk(s.dir, '');
  return out.sort(bytewise);
}

// Lines of the UTF-8 files under dir that contain literal, split as
// kogen-context splits them.
function countMatchingLines(dir, literal) {
  let count = 0;
  const decoder = new TextDecoder('utf-8', { fatal: true });
  eachFile(dir, (abs) => {
    let text;
    try {
      text = decoder.decode(fs.readFileSync(abs));
    } catch {
      return;
    }
    const parts = text.split('\n');
    if (parts[parts.length - 1] === '') parts.pop();
    for (const [i, line] of parts.entries()) {
      const cut = i < parts.length - 1 || text.endsWith('\n') ? line.replace(/\r$/, '') : line;
      if (cut.includes(literal)) count += 1;
    }
  });
  return count;
}

function timed(fn) {
  const start = process.hrtime.bigint();
  const result = fn();
  return { result, ms: Number(process.hrtime.bigint() - start) / 1e6 };
}

const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

// Times RUNS searches of kogen-context and RUNS ripgrep runs, interleaved,
// in both orders, checking every packet against the plain copy's and every
// ripgrep output against the number of matching lines.
function measure(s, env, row, phase) {
  const top = checkoutOf(s, row.root);
  const rootDir = path.join(s.dir, row.root);
  const plain = plainOutputs(s, top, ORDERS.map((order) => ({ kind: 'request', root: row.root, literal: row.literal, order })));
  const expected = countMatchingLines(rootDir, row.literal);
  assert.ok(expected > 0, `${row.root} has no line with ${row.literal}`);
  ORDERS.forEach((order, i) => {
    const kogen = [];
    const rg = [];
    for (let k = 0; k < RUNS; k++) {
      const a = timed(() => runSync(s.dir, env, 'request', row.root, row.literal, order));
      const run = { kind: 'request', root: row.root, literal: row.literal, order, ...a.result };
      assert.ok(
        run.status === 0 && run.stdout.equals(plain[i].stdout),
        `${phase} ${describeRun(run, k + 1)}\ndiffers from the plain copy's stdout ${JSON.stringify(String(plain[i].stdout))}`,
      );
      kogen.push(a.ms);
      const b = timed(() => spawnSync('rg', [...RG_OPTIONS, '-e', row.literal, '.'], { cwd: rootDir, maxBuffer: 256 << 20 }));
      const r = b.result;
      if (r.error) throw new Error(`cannot run rg: ${r.error.message}`);
      const lines = String(r.stdout).split('\n').filter((l) => l !== '').length;
      assert.ok(
        r.status === 0 && lines === expected,
        `rg ${RG_OPTIONS.join(' ')} -e ${row.literal} . in ${rootDir}: exit ${r.status}, ${lines} lines, expected ${expected}; stderr ${String(r.stderr)}`,
      );
      rg.push(b.ms);
    }
    s.timings.push({ root: row.root, phase, order, kogen: median(kogen), rg: median(rg) });
  });
}

function timingTable(s) {
  return s.timings
    .map((t) => `${t.root}\t${t.phase}\t${t.order}\tkogen-context ${t.kogen.toFixed(2)} ms\tripgrep ${t.rg === null ? '-' : `${t.rg.toFixed(2)} ms`}`)
    .join('\n');
}

Given(P + 'a Git checkout {string} committed with these files:', function (name, table) {
  const s = scenario(this);
  const dir = newCheckout(s, name);
  for (const row of table.hashes()) writeFile(path.join(dir, row.path), unescape(row.content));
  git(s, dir, ['init', '-q']);
  commitAll(s, dir, 'fixture');
});

Given(P + 'a plain directory {string} with these files:', function (name, table) {
  const s = scenario(this);
  const dir = newCheckout(s, name);
  for (const row of table.hashes()) writeFile(path.join(dir, row.path), unescape(row.content));
});

Given(P + 'the checkout {string} has a worktree {string} at its commit', function (name, worktree) {
  const s = scenario(this);
  git(s, path.join(s.dir, name), ['worktree', 'add', '-q', '--detach', path.join(s.dir, worktree), 'HEAD']);
  s.checkouts.push(worktree);
});

Given(
  P + 'a generated Git checkout {string} with {int} files of {int} lines and the literal {string} on line {int} of every {int}th file',
  { timeout: 600000 },
  function (name, files, lines, literal, line, every) {
    const s = scenario(this);
    const dir = newCheckout(s, name);
    for (let f = 0; f < files; f++) {
      const rows = [];
      for (let l = 1; l <= lines; l++) {
        rows.push(
          f % every === 0 && l === line
            ? `pub const marker_${f} = "${literal}";`
            : `const value_${f}_${l} = compute(${f}, ${l}); // filler line of the benchmark fixture`,
        );
      }
      const pkg = `pkg${String(Math.floor(f / 100)).padStart(2, '0')}`;
      writeFile(path.join(dir, pkg, `file${String(f).padStart(4, '0')}.zig`), `${rows.join('\n')}\n`);
    }
    git(s, dir, ['init', '-q']);
    commitAll(s, dir, 'generated fixture');
  },
);

Given(P + 'a Git checkout {string} with copies of these repository directories:', { timeout: 120000 }, function (name, table) {
  const s = scenario(this);
  const dir = newCheckout(s, name);
  for (const row of table.hashes()) copyTree(path.join(repoRoot, row.directory), path.join(dir, row.as));
  git(s, dir, ['init', '-q']);
  commitAll(s, dir, 'repository fixtures');
});

Given(P + 'the files of every checkout are more than 2 seconds old', { timeout: 120000 }, function () {
  const s = scenario(this);
  let latest = 0;
  for (const name of s.checkouts) {
    eachFile(path.join(s.dir, name), (abs) => {
      fs.utimesSync(abs, AGED_SECONDS, AGED_SECONDS);
      latest = Math.max(latest, fs.lstatSync(abs).ctimeMs);
    });
  }
  // Setting the times changed the change time; wait until that is old too.
  sleep(latest + AGE_WAIT_MS - Date.now());
});

Given(P + 'XDG_CACHE_HOME is {string} and HOME is {string}', function (xdg, home) {
  const s = scenario(this);
  const value = (v) => (v === '<unset>' ? null : expand(s, v));
  s.settings = { XDG_CACHE_HOME: value(xdg), HOME: value(home) };
});

When(P + 'I search {string} for {string} in {string} order', { timeout: 300000 }, function (root, literal, order) {
  search(this, 'request', root, literal, order);
});

When(P + 'I run kogen-context search {string} {string}', { timeout: 300000 }, function (root, literal) {
  search(this, 'cli', root, literal, null);
});

When(P + 'I start these searches at once and wait for all of them:', { timeout: 300000 }, async function (table) {
  const s = scenario(this);
  const rows = table.hashes();
  const before = recordCheckouts(s);
  const env = kogenEnv(s);
  const results = await Promise.all(rows.map((row) => startRequest(s.dir, env, row.root, row.literal, row.order)));
  const changed = checkoutChanges(s, before);
  rows.forEach((row, i) => {
    const [plain] = plainOutputs(s, checkoutOf(s, row.root), [{ kind: 'request', ...row }]);
    s.runs.push({ kind: 'request', ...row, ...results[i], plain, changed });
  });
});

When(P + 'I write {string} in {string} with the content {string}', function (rel, name, content) {
  const s = scenario(this);
  checkoutOf(s, name);
  writeFile(path.join(s.dir, name, rel), unescape(content));
});

When(P + 'I write {string} in {string} with the content {string} keeping its size and modification time', function (rel, name, content) {
  const s = scenario(this);
  checkoutOf(s, name);
  const file = path.join(s.dir, name, rel);
  const before = fs.lstatSync(file, { bigint: true });
  const bytes = Buffer.from(unescape(content));
  assert.equal(BigInt(bytes.length), before.size, `the new content of ${rel} must have the size of the old one`);
  assert.equal(before.mtimeNs % 1000000000n, 0n, `${rel} must have a whole-second modification time; age the files first`);
  fs.writeFileSync(file, bytes);
  fs.utimesSync(file, Number(before.atimeNs / 1000000000n), Number(before.mtimeNs / 1000000000n));
  const after = fs.lstatSync(file, { bigint: true });
  assert.ok(after.size === before.size && after.mtimeNs === before.mtimeNs, `${rel} kept neither its size nor its modification time`);
  assert.ok(after.ino === before.ino, `${rel} was replaced instead of rewritten in place`);
});

When(P + 'I delete {string} from {string}', function (rel, name) {
  const s = scenario(this);
  checkoutOf(s, name);
  fs.rmSync(path.join(s.dir, name, rel));
});

When(P + 'I commit every change of the checkout {string}', function (name) {
  const s = scenario(this);
  s.previousCommits[name] = head(s, name);
  commitAll(s, path.join(s.dir, name), 'change');
});

When(P + 'I note the state of the directory {string}', function (rel) {
  const s = scenario(this);
  const dir = path.join(s.dir, rel);
  assert.ok(fs.existsSync(dir), `${rel} does not exist`);
  s.noted[rel] = record(dir);
});

When(P + 'I time kogen-context against ripgrep on these searches:', { timeout: 1800000 }, function (table) {
  const s = scenario(this);
  const env = kogenEnv(s);
  for (const row of table.hashes()) {
    const top = checkoutOf(s, row.root);
    const [plain] = plainOutputs(s, top, [{ kind: 'request', root: row.root, literal: row.literal, order: 'path' }]);
    const cold = timed(() => runSync(s.dir, env, 'request', row.root, row.literal, 'path'));
    const run = { kind: 'request', root: row.root, literal: row.literal, order: 'path', ...cold.result };
    assert.ok(run.status === 0 && run.stdout.equals(plain.stdout), `cold ${describeRun(run, 1)}\ndiffers from the plain copy's stdout ${JSON.stringify(String(plain.stdout))}`);
    s.timings.push({ root: row.root, phase: 'cold', order: 'path', kogen: cold.ms, rg: null });
    measure(s, env, row, 'warm');
    const file = path.join(s.dir, row.root, row.edit);
    const old = fs.readFileSync(file);
    const separator = old.length > 0 && old[old.length - 1] !== 0x0a ? '\n' : '';
    fs.appendFileSync(file, `${separator}edited ${row.literal}\n`);
    writeFile(path.join(s.dir, row.root, 'added-by-benchmark.txt'), `added ${row.literal}\n`);
    measure(s, env, row, 'after-edit');
  }
  this.attach(timingTable(s), 'text/plain');
});

When(P + 'I run the Crane benchmark script with the release kogen-context binary', { timeout: 1800000 }, function () {
  const s = scenario(this);
  const tmp = path.join(s.dir, 'tmp');
  fs.mkdirSync(tmp);
  const env = { ...cleanEnv(), TMPDIR: tmp, HOME: path.join(s.dir, 'home'), XDG_CACHE_HOME: path.join(s.dir, 'cache') };
  const r = spawnSync('sh', [CRANE_SCRIPT, binary], { cwd: repoRoot, env, encoding: 'utf8', timeout: 1790000, maxBuffer: 64 << 20 });
  s.script = { status: r.status, signal: r.signal, error: r.error, stdout: r.stdout || '', stderr: r.stderr || '' };
});

When(P + 'I run the Crane benchmark script without an argument', { timeout: 60000 }, function () {
  const s = scenario(this);
  const r = spawnSync('sh', [CRANE_SCRIPT], { cwd: repoRoot, env: cleanEnv(), encoding: 'utf8', timeout: 50000 });
  s.script = { status: r.status, signal: r.signal, error: r.error, stdout: r.stdout || '', stderr: r.stderr || '' };
});

When(P + 'I run the ignored tests of the repository in a release build with a benchmark report file', { timeout: 1800000 }, function () {
  const s = scenario(this);
  const report = path.join(s.dir, 'bench-report.tsv');
  const env = { ...process.env, KOGEN_CONTEXT_BENCH_REPORT: report };
  const r = spawnSync(BENCH_COMMAND[0], BENCH_COMMAND.slice(1), { cwd: repoRoot, env, encoding: 'utf8', timeout: 1790000, maxBuffer: 64 << 20 });
  s.bench = {
    status: r.status,
    signal: r.signal,
    error: r.error,
    output: `${r.stdout || ''}${r.stderr || ''}`,
    report: fs.existsSync(report) ? fs.readFileSync(report, 'utf8') : null,
  };
});

function describeBench(s) {
  const b = s.bench;
  return `${BENCH_COMMAND.join(' ')} with KOGEN_CONTEXT_BENCH_REPORT set: exit ${b.status}, signal ${b.signal}, error ${b.error}, report ${b.report === null ? 'not written' : JSON.stringify(b.report)}\noutput (end):\n${b.output.slice(-6000)}`;
}

Then(P + 'every search exited with status 0 and printed nothing on stderr', function () {
  const s = scenario(this);
  assert.ok(s.runs.length > 0, 'no search ran in this scenario');
  const bad = s.runs.map((run, i) => (run.status === 0 && run.stderr.length === 0 ? null : describeRun(run, i + 1))).filter(Boolean);
  assert.deepEqual(bad, [], `searches failed:\n${bad.join('\n')}`);
});

Then(P + 'every search printed byte for byte what the same search prints on a plain copy of its checkout without Git', function () {
  const s = scenario(this);
  assert.ok(s.runs.length > 0, 'no search ran in this scenario');
  const bad = [];
  s.runs.forEach((run, i) => {
    const p = run.plain;
    if (run.status !== p.status || !run.stdout.equals(p.stdout) || !run.stderr.equals(p.stderr)) {
      bad.push(`${describeRun(run, i + 1)}\n  plain copy: exit ${p.status}, stdout ${JSON.stringify(String(p.stdout))}, stderr ${JSON.stringify(String(p.stderr))}`);
    }
  });
  assert.deepEqual(bad, [], `outputs differ from the plain copy's:\n${bad.join('\n')}`);
});

Then(P + 'the packet of search {int} is a search for {string} listing exactly these matches:', function (n, literal, table) {
  const s = scenario(this);
  const run = s.runs[n - 1];
  assert.ok(run && run.kind === 'request', `search ${n} is not a request of this scenario`);
  let packet;
  try {
    packet = JSON.parse(String(run.stdout));
  } catch (e) {
    assert.fail(`${describeRun(run, n)} is not one JSON packet: ${e.message}`);
  }
  const matches = table.hashes().map((r) => ({ path: r.path, line: Number(r.line), column: Number(r.column), text: r.text }));
  assert.deepEqual(
    packet,
    { version: 1, operation: 'search', query: literal, matches, truncated: false, limits: { max_matches: 100, max_line_chars: 500 } },
    describeRun(run, n),
  );
});

Then(P + 'the packets of search {int} and search {int} are byte for byte the same', function (a, b) {
  const s = scenario(this);
  const [x, y] = [s.runs[a - 1], s.runs[b - 1]];
  assert.ok(x && y, `search ${a} or ${b} did not run`);
  assert.ok(x.stdout.equals(y.stdout), `${describeRun(x, a)}\n${describeRun(y, b)}`);
});

Then(P + 'no search changed anything in the checkouts', function () {
  const s = scenario(this);
  assert.ok(s.runs.length > 0, 'no search ran in this scenario');
  const bad = s.runs.flatMap((run, i) => run.changed.map((c) => `search ${i + 1} changed ${c}`));
  assert.deepEqual([...new Set(bad)], [], 'a search changed a checkout');
});

Then(P + 'the files under the scenario directory outside the checkouts are exactly:', function (table) {
  const s = scenario(this);
  const expected = table.hashes().map((r) => expand(s, r.file)).sort(bytewise);
  assert.deepEqual(filesOutsideCheckouts(s), expected);
});

Then(P + 'no file is under the scenario directory outside the checkouts', function () {
  const s = scenario(this);
  assert.deepEqual(filesOutsideCheckouts(s), []);
});

Then(P + 'kogen-context made the directory {string} and everything in it private to the user', function (rel) {
  const s = scenario(this);
  const top = path.join(s.dir, expand(s, rel));
  const bad = [];
  const walk = (abs) => {
    const st = fs.lstatSync(abs);
    const mode = st.mode & 0o777;
    if (st.isDirectory()) {
      if (mode !== 0o700) bad.push(`${path.relative(s.dir, abs)}: directory mode ${mode.toString(8)}`);
      for (const name of fs.readdirSync(abs)) walk(path.join(abs, name));
    } else if (mode !== 0o600) bad.push(`${path.relative(s.dir, abs)}: file mode ${mode.toString(8)}`);
  };
  walk(top);
  assert.deepEqual(bad, [], 'expected directories with mode 700 and files with mode 600');
});

Then(P + 'the directory {string} is unchanged since it was noted', function (rel) {
  const s = scenario(this);
  assert.ok(s.noted[rel], `the state of ${rel} was not noted`);
  assert.deepEqual(changes(s.noted[rel], record(path.join(s.dir, rel))), [], `${rel} changed`);
});

Then(
  P + 'the file {string} was replaced since the directory {string} was noted, and nothing else in that directory changed but the directory holding the file',
  function (file, rel) {
    const s = scenario(this);
    assert.ok(s.noted[rel], `the state of ${rel} was not noted`);
    const inside = path.relative(rel, expand(s, file)).split(path.sep).join('/');
    const now = record(path.join(s.dir, rel));
    assert.deepEqual(changes(s.noted[rel], now), [path.posix.dirname(inside), inside].sort(bytewise), `changes in ${rel}`);
    const [before, after] = [inode(s.noted[rel].get(inside)), inode(now.get(inside))];
    assert.ok(before && after && before !== after, `${inside} was not replaced by a new file (inode ${before} before, ${after} now)`);
  },
);

Then(P + 'every warm and after-edit median of kogen-context is at or below the ripgrep median', function () {
  const s = scenario(this);
  const judged = s.timings.filter((t) => t.phase !== 'cold');
  assert.ok(judged.length > 0, 'nothing was timed in this scenario');
  const slow = judged.filter((t) => t.kogen > t.rg);
  assert.equal(slow.length, 0, `kogen-context took longer than ripgrep in ${slow.length} of ${judged.length} medians of ${RUNS} runs:\n${timingTable(s)}`);
});

Then(P + 'the benchmark test run exited with status 0', function () {
  const s = scenario(this);
  assert.ok(s.bench, 'the benchmark test did not run');
  assert.equal(s.bench.status, 0, describeBench(s));
});

Then(P + 'the benchmark report lists exactly these measurements against ripgrep:', function (table) {
  const s = scenario(this);
  assert.ok(s.bench, 'the benchmark test did not run');
  const text = s.bench.report || '';
  const rows = text === '' ? [] : text.replace(/\n$/, '').split('\n').map((line) => line.split('\t'));
  const expected = table.hashes().map((r) => `${r.phase}\t${r.order}`);
  assert.deepEqual(rows.map((r) => r.slice(0, 2).join('\t')), expected, `the benchmark report lacks the measurements\n${describeBench(s)}`);
  assert.ok(text.endsWith('\n'), `the benchmark report does not end with a newline\n${describeBench(s)}`);
  const bad = rows.filter((r) => r.length !== 4 || !/^\d+\.\d$/.test(r[2]) || !/^\d+\.\d$/.test(r[3]));
  assert.deepEqual(bad.map((r) => r.join('\t')), [], `report lines without four tab-separated fields ending in two times like 12.3\n${describeBench(s)}`);
  s.benchRows = rows;
});

Then(P + 'in every warm and after-edit measurement of the report kogen-context took at most as long as ripgrep', function () {
  const s = scenario(this);
  assert.ok(s.benchRows, 'the benchmark report was not read');
  const slow = s.benchRows.filter((r) => r[0] !== 'cold' && Number(r[2]) > Number(r[3]));
  assert.deepEqual(slow.map((r) => r.join('\t')), [], `kogen-context took longer than ripgrep:\n${s.bench.report}`);
  this.attach(s.bench.report, 'text/plain');
});

function describeScript(s) {
  return `script: exit ${s.script.status}, signal ${s.script.signal}, error ${s.script.error}\nstdout:\n${s.script.stdout}\nstderr:\n${s.script.stderr}`;
}

Then(P + 'the script exited with status {int}', function (status) {
  const s = scenario(this);
  assert.ok(s.script, 'the script did not run');
  assert.equal(s.script.status, status, describeScript(s));
});

Then(P + 'the script printed exactly these records, with times in milliseconds:', function (table) {
  const s = scenario(this);
  const out = s.script.stdout;
  assert.ok(out.endsWith('\n'), `stdout does not end with a newline\n${describeScript(s)}`);
  const rows = out.slice(0, -1).split('\n').map((line) => line.split('\t'));
  const bad = rows.filter((r) => r.length !== 6 || !/^\d+\.\d$/.test(r[4]) || !/^\d+\.\d$/.test(r[5]));
  assert.deepEqual(bad.map((r) => r.join('\t')), [], 'records without six tab-separated fields ending in two times like 12.3');
  assert.deepEqual(rows.map((r) => r.slice(0, 4).join('\t')), table.hashes().map((r) => [r.label, r.phase, r.order, r.hint].join('\t')));
  s.records = rows;
});

Then(P + 'in every warm and after-edit record kogen-context took at most as long as ripgrep', function () {
  const s = scenario(this);
  assert.ok(s.records, 'the records were not read');
  const judged = s.records.filter((r) => r[1] !== 'cold');
  const slow = judged.filter((r) => Number(r[4]) > Number(r[5]));
  assert.deepEqual(slow.map((r) => r.join('\t')), [], `kogen-context took longer than ripgrep:\n${s.script.stdout}`);
  this.attach(s.script.stdout, 'text/plain');
});

Then(P + 'the script printed nothing on stdout and exactly {string} and a newline on stderr', function (text) {
  const s = scenario(this);
  assert.equal(s.script.stdout, '', describeScript(s));
  assert.equal(s.script.stderr, `${text}\n`, describeScript(s));
});

Then(P + 'no file is in the temporary, home or cache directory of the script run', function () {
  const s = scenario(this);
  const left = [];
  for (const name of ['tmp', 'home', 'cache']) {
    const dir = path.join(s.dir, name);
    if (fs.existsSync(dir)) {
      for (const entry of fs.readdirSync(dir)) left.push(`${name}/${entry}`);
    }
  }
  assert.deepEqual(left, []);
});

Then(P + 'the file {string} contains each of these texts:', function (rel, table) {
  const text = fs.readFileSync(path.join(repoRoot, rel), 'utf8');
  const missing = table.hashes().map((r) => r.text).filter((t) => !text.includes(t));
  assert.deepEqual(missing, [], `${rel} lacks these texts`);
});

Then(P + 'the file {string} does not contain {string}', function (rel, unwanted) {
  const text = fs.readFileSync(path.join(repoRoot, rel), 'utf8');
  assert.ok(!text.includes(unwanted), `${rel} contains ${JSON.stringify(unwanted)}`);
});

Then(P + 'the file {string} has the SHA-256 digest {string}', function (rel, digest) {
  const hash = require('node:crypto').createHash('sha256').update(fs.readFileSync(path.join(repoRoot, rel))).digest('hex');
  assert.equal(hash, digest, `${rel} changed`);
});
