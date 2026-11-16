'use strict';

// Steps of the Intent context-index-cache-prunes-old-files. They run the
// release binary of kogen-context (`search ROOT LITERAL`) on temporary Git
// checkouts with a temporary cache directory, age files in the cache with
// utimes, and check which index files remain. Every search is compared with
// the same search on a plain copy of the checkout without Git.

const { After, BeforeAll, Given, Then, When } = require('@cucumber/cucumber');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const P = 'context-index-cache-prunes-old-files: ';
const repoRoot = path.resolve(__dirname, '..', '..');
const targetDir = process.env.CARGO_TARGET_DIR
  ? path.resolve(repoRoot, process.env.CARGO_TARGET_DIR)
  : path.join(repoRoot, 'target');
const binary = path.join(targetDir, 'release', 'kogen-context');
const buildCommand = ['cargo', 'build', '--release', '--locked', '--offline', '--bin', 'kogen-context'];
const AGED_SECONDS = 1577836800; // 2020-01-01T00:00:00Z
const DAY_MS = 24 * 60 * 60 * 1000;
const LITERAL = 'needle';

BeforeAll({ timeout: 600000 }, function () {
  const r = spawnSync(buildCommand[0], buildCommand.slice(1), { cwd: repoRoot, encoding: 'utf8', timeout: 590000 });
  if (r.status !== 0) {
    throw new Error(
      `${buildCommand.join(' ')} failed in ${repoRoot} (status ${r.status}, signal ${r.signal}, error ${r.error}):\n${r.stdout}${r.stderr}`,
    );
  }
});

After(function () {
  const s = this.cip;
  if (!s) return;
  const trees = path.join(s.cache, 'kogen-context', 'index-v1', 'trees');
  if (fs.existsSync(trees)) fs.chmodSync(trees, 0o700);
  fs.rmSync(s.dir, { recursive: true, force: true });
});

function gitAncestor(dir) {
  for (let d = dir; ; d = path.dirname(d)) {
    if (fs.existsSync(path.join(d, '.git'))) return d;
    if (path.dirname(d) === d) return null;
  }
}

function scenario(world) {
  if (!world.cip) {
    const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'cip-')));
    assert.equal(gitAncestor(dir), null, `the temporary directory ${dir} is inside a Git checkout; set TMPDIR outside every checkout`);
    fs.mkdirSync(path.join(dir, 'home'));
    world.cip = {
      dir,
      cache: path.join(dir, 'cache'),
      commits: {},
      counter: 0,
      plain: 0,
      last: null,
      noted: null,
      writable: false,
    };
  }
  return world.cip;
}

function cleanEnv() {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (!k.startsWith('GIT_') && k !== 'XDG_CACHE_HOME' && k !== 'HOME') env[k] = v;
  }
  return env;
}

function git(s, cwd, args) {
  const r = spawnSync('git', ['-c', 'core.autocrlf=false', '-c', 'commit.gpgsign=false', '-c', 'init.defaultBranch=main', ...args], {
    cwd,
    encoding: 'utf8',
    env: {
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
    },
  });
  assert.equal(r.status, 0, `git ${args.join(' ')} failed: ${r.stderr}`);
  return r.stdout.trim();
}

function commitAll(s, name) {
  git(s, path.join(s.dir, name), ['add', '-A']);
  git(s, path.join(s.dir, name), ['commit', '-q', '-m', 'change']);
  return git(s, path.join(s.dir, name), ['rev-parse', 'HEAD']);
}

function fnv1a(text) {
  let hash = 0xcbf29ce484222325n;
  for (const b of Buffer.from(text)) {
    hash ^= BigInt(b);
    hash = (hash * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return hash.toString(16).padStart(16, '0');
}

function indexDir(s, kind) {
  return path.join(s.cache, 'kogen-context', 'index-v1', kind);
}

// Every file and directory below dir with its type, size, mode and mtime.
function state(dir) {
  const out = {};
  const walk = (d) => {
    for (const name of fs.readdirSync(d)) {
      const p = path.join(d, name);
      const st = fs.lstatSync(p);
      out[path.relative(dir, p)] = [st.isSymbolicLink() ? 'link' : st.isDirectory() ? 'dir' : 'file', st.size, st.mode, st.mtimeMs].join(' ');
      if (st.isDirectory()) walk(p);
    }
  };
  if (fs.existsSync(dir)) walk(dir);
  return out;
}

function checkoutsState(s) {
  const out = {};
  for (const name of fs.readdirSync(s.dir)) {
    if (['cache', 'home', 'outside.txt'].includes(name) || name.startsWith('plain-')) continue;
    const walk = (d) => {
      for (const n of fs.readdirSync(d)) {
        const q = path.join(d, n);
        const st = fs.lstatSync(q);
        out[q] = st.isDirectory() ? 'dir' : `${st.size} ${st.mtimeMs} ${st.ctimeMs} ${fs.readFileSync(q).toString('base64')}`;
        if (st.isDirectory()) walk(q);
      }
    };
    walk(path.join(s.dir, name));
  }
  return JSON.stringify(out);
}

function setAge(file, days) {
  const t = new Date(Date.now() - days * DAY_MS);
  fs.utimesSync(file, t, t);
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function runSearch(root, env) {
  return spawnSync(binary, ['search', root, LITERAL], { encoding: 'utf8', env, timeout: 60000 });
}

Given(P + 'a Git checkout {string} whose commit is called {string}', function (name, label) {
  const s = scenario(this);
  fs.mkdirSync(path.join(s.dir, name, 'src'), { recursive: true });
  fs.writeFileSync(path.join(s.dir, name, 'src', 'main.txt'), `first ${LITERAL}\nmore\n`);
  git(s, path.join(s.dir, name), ['init', '-q']);
  s.commits[label] = commitAll(s, name);
});

When(P + '{string} gets a new commit called {string}', function (name, label) {
  const s = scenario(this);
  s.counter += 1;
  fs.writeFileSync(path.join(s.dir, name, 'src', 'main.txt'), `change ${s.counter} ${LITERAL}\nmore\n`);
  s.commits[label] = commitAll(s, name);
});

When(P + 'a new file {string} is written in {string}', function (file, name) {
  const s = scenario(this);
  fs.writeFileSync(path.join(s.dir, name, file), `extra ${LITERAL}\n`);
});

When(P + 'the working tree files are aged', function () {
  const s = scenario(this);
  const aged = new Date(AGED_SECONDS * 1000);
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.isDirectory() && e.name !== '.git') walk(path.join(d, e.name));
      else if (e.isFile()) fs.utimesSync(path.join(d, e.name), aged, aged);
    }
  };
  for (const name of fs.readdirSync(s.dir)) {
    const p = path.join(s.dir, name);
    if (!['cache', 'home'].includes(name) && fs.statSync(p).isDirectory()) walk(p);
  }
  sleep(3200);
});

When(P + '{string} is searched', function (name) {
  const s = scenario(this);
  const before = checkoutsState(s);
  const env = { ...cleanEnv(), XDG_CACHE_HOME: s.cache, HOME: path.join(s.dir, 'home') };
  const out = runSearch(path.join(s.dir, name), env);
  const changed = checkoutsState(s) !== before;
  s.plain += 1;
  const plainDir = path.join(s.dir, `plain-${s.plain}`);
  fs.cpSync(path.join(s.dir, name), path.join(plainDir, name), { recursive: true, filter: (src) => path.basename(src) !== '.git' });
  const unused = path.join(plainDir, 'unused-cache');
  const plain = runSearch(path.join(plainDir, name), { ...cleanEnv(), XDG_CACHE_HOME: unused, HOME: path.join(plainDir, 'unused-home') });
  assert.equal(fs.existsSync(unused), false, 'the plain copy search wrote a cache');
  fs.rmSync(plainDir, { recursive: true, force: true });
  s.last = { status: out.status, stdout: out.stdout, stderr: out.stderr, plainStatus: plain.status, plainStdout: plain.stdout, changed };
});

When(P + 'the commit index file of {string} is set {int} days old', function (label, days) {
  const s = scenario(this);
  setAge(path.join(indexDir(s, 'commits'), s.commits[label]), days);
});

When(P + 'the tree snapshot files of {string} are set {int} days old', function (label, days) {
  const s = scenario(this);
  const dir = indexDir(s, 'trees');
  const files = fs.readdirSync(dir).filter((n) => n.startsWith(`${s.commits[label]}-`));
  assert.ok(files.length > 0, `no tree snapshot file of ${label} in ${dir}`);
  for (const f of files) setAge(path.join(dir, f), days);
});

When(P + 'the file {string} is written below the scenario directory', function (rel) {
  const s = scenario(this);
  fs.mkdirSync(path.dirname(path.join(s.dir, rel)), { recursive: true });
  fs.writeFileSync(path.join(s.dir, rel), 'kept\n');
});

When(P + 'the symlink {string} is made pointing at {string}', function (link, target) {
  const s = scenario(this);
  fs.symlinkSync(path.join(s.dir, target), path.join(s.dir, link));
});

When(P + 'the file {string} is set {int} days old', function (rel, days) {
  const s = scenario(this);
  setAge(path.join(s.dir, rel), days);
});

When(P + 'the state of the cache directory is noted', function () {
  const s = scenario(this);
  s.noted = state(s.cache);
});

When(P + 'the hidden file {string} is left in the {word} directory and set {int} days old', function (name, kind, days) {
  const s = scenario(this);
  const file = path.join(indexDir(s, kind), name);
  fs.writeFileSync(file, 'killed mid-write\n');
  setAge(file, days);
});

When(P + 'the trees directory is made unwritable', function () {
  const s = scenario(this);
  const dir = indexDir(s, 'trees');
  fs.chmodSync(dir, 0o500);
  try {
    fs.writeFileSync(path.join(dir, '.probe'), 'x');
    fs.rmSync(path.join(dir, '.probe'), { force: true });
    s.writable = true; // a user who ignores modes: nothing to observe
  } catch (e) {
    s.writable = false;
  }
});

Then(P + 'the regular files in the index directories are exactly the files of the commits {string}', function (labels) {
  const s = scenario(this);
  const wanted = [];
  for (const label of labels.split(',').map((l) => l.trim())) {
    const commit = s.commits[label];
    assert.ok(commit, `unknown commit label ${label}`);
    wanted.push(`commits/${commit}`);
    for (const name of fs.readdirSync(s.dir)) {
      const top = path.join(s.dir, name);
      if (fs.existsSync(path.join(top, '.git'))) wanted.push(`trees/${commit}-${fnv1a(top)}`);
    }
  }
  const found = [];
  for (const kind of ['commits', 'trees']) {
    const dir = indexDir(s, kind);
    if (!fs.existsSync(dir)) continue;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) if (e.isFile()) found.push(`${kind}/${e.name}`);
  }
  assert.deepEqual(found.sort(), [...new Set(wanted)].sort());
});

Then(P + 'the file {string} still exists below the scenario directory', function (rel) {
  const s = scenario(this);
  assert.ok(fs.existsSync(path.join(s.dir, rel)), `${rel} was removed`);
});

Then(P + 'the symlink {string} still exists below the scenario directory', function (rel) {
  const s = scenario(this);
  let st;
  try {
    st = fs.lstatSync(path.join(s.dir, rel));
  } catch (e) {
    assert.fail(`${rel} was removed`);
  }
  assert.ok(st.isSymbolicLink(), `${rel} is no longer a symlink`);
});

Then(P + 'the state of the cache directory is the noted one', function () {
  const s = scenario(this);
  assert.ok(s.noted, 'no state was noted');
  assert.deepEqual(state(s.cache), s.noted);
});

Then(P + 'the last search succeeded, printed the packet of a plain copy and left the checkouts unchanged', function () {
  const s = scenario(this);
  const l = s.last;
  assert.ok(l, 'no search ran');
  assert.equal(l.stderr, '', `stderr: ${l.stderr}`);
  assert.equal(l.status, 0, `exit status ${l.status}`);
  assert.equal(l.plainStatus, 0);
  assert.equal(l.stdout, l.plainStdout);
  assert.ok(l.stdout.includes(LITERAL), 'the output has no match');
  assert.equal(l.changed, false, 'a search changed a checkout');
});

Then(P + 'the hidden file {string} is gone from the {word} directory', function (name, kind) {
  const s = scenario(this);
  assert.equal(fs.existsSync(path.join(indexDir(s, kind), name)), false, `${name} still exists in the ${kind} directory`);
});
