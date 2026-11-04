'use strict';

const { After, BeforeAll, Given, Then, When } = require('@cucumber/cucumber');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { artifactName, checkArtifacts } = require('./k-context-release-binaries__check.js');

const P = 'k-context-release-binaries: ';
const repoRoot = path.resolve(__dirname, '..', '..');
const targetDir = process.env.CARGO_TARGET_DIR
  ? path.resolve(repoRoot, process.env.CARGO_TARGET_DIR)
  : path.join(repoRoot, 'target');
const devBinary = path.join(targetDir, 'debug', 'kogen-context');
const buildCommand = ['cargo', 'build', '--locked', '--offline', '--bin', 'kogen-context'];
const releaseDir = 'target/kogen-context-release';
const stepTimeout = 600000;
const commandTimeout = 590000;
// Paths of the working tree that a copy leaves out: Git data, build output and local Kogen state.
const skipped = new Set(['.git', 'target', '.kogen/local']);
const date = '2026-01-01T00:00:00Z';

// The environment of every command the steps run: no inherited release, golden
// or Git repository settings, no user or system Git configuration and fixed
// commit identities and dates, so equal trees give equal commits.
function baseEnv() {
  const env = { ...process.env };
  for (const name of [
    'KOGEN_CONTEXT_BIN',
    'KOGEN_CONTEXT_RELEASE_TAG',
    'KOGEN_CONTEXT_RELEASE_COMMIT',
    'KOGEN_CONTEXT_UPDATE_GOLDENS',
    'GIT_DIR',
    'GIT_WORK_TREE',
    'GIT_INDEX_FILE',
    'GIT_OBJECT_DIRECTORY',
    'GIT_ALTERNATE_OBJECT_DIRECTORIES',
    'GIT_CEILING_DIRECTORIES',
  ]) {
    delete env[name];
  }
  return {
    ...env,
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_NAME: 'Kogen Acceptance',
    GIT_AUTHOR_EMAIL: 'acceptance@kogen.invalid',
    GIT_COMMITTER_NAME: 'Kogen Acceptance',
    GIT_COMMITTER_EMAIL: 'acceptance@kogen.invalid',
    GIT_AUTHOR_DATE: date,
    GIT_COMMITTER_DATE: date,
  };
}

BeforeAll({ timeout: stepTimeout }, function () {
  const r = spawnSync(buildCommand[0], buildCommand.slice(1), {
    cwd: repoRoot,
    env: baseEnv(),
    encoding: 'utf8',
    timeout: commandTimeout,
  });
  if (r.status !== 0) {
    throw new Error(
      `${buildCommand.join(' ')} failed in ${repoRoot} (status ${r.status}, signal ${r.signal}, error ${r.error}):\n${r.stdout}${r.stderr}`,
    );
  }
});

After(function () {
  if (this.kcrb && this.kcrb.temp) fs.rmSync(this.kcrb.temp, { recursive: true, force: true });
});

function state(world) {
  if (!world.kcrb) world.kcrb = { copies: {} };
  return world.kcrb;
}

function fail(message) {
  throw new Error(message);
}

function expectEqual(actual, expected, message) {
  if (actual !== expected) fail(`${message}\nexpected: ${JSON.stringify(expected)}\nactual:   ${JSON.stringify(actual)}`);
}

function temp(world) {
  const s = state(world);
  if (!s.temp) s.temp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kogen-context-release-')));
  return s.temp;
}

function copyRoot(world, name) {
  const root = state(world).copies[name];
  if (!root) fail(`copy ${JSON.stringify(name)} was not created by an earlier step`);
  return root;
}

function git(cwd, args) {
  const r = spawnSync('git', args, { cwd, env: baseEnv(), encoding: 'utf8', timeout: commandTimeout });
  if (r.status !== 0) {
    fail(`git ${args.join(' ')} failed in ${cwd} (status ${r.status}, signal ${r.signal}, error ${r.error}):\n${r.stdout}${r.stderr}`);
  }
  return r.stdout;
}

function commitOf(root, rev) {
  return git(root, ['rev-parse', '--verify', `${rev}^{commit}`]).trim();
}

// Copies the working tree (regular files with their modes and symlinks as
// links), without the skipped paths.
function copyTree(src, dest, rel = '') {
  fs.mkdirSync(dest, { recursive: true });
  for (const name of fs.readdirSync(src).sort()) {
    const r = rel ? `${rel}/${name}` : name;
    if (skipped.has(r)) continue;
    const from = path.join(src, name);
    const to = path.join(dest, name);
    const st = fs.lstatSync(from);
    if (st.isSymbolicLink()) fs.symlinkSync(fs.readlinkSync(from), to);
    else if (st.isDirectory()) copyTree(from, to, r);
    else if (st.isFile()) {
      fs.copyFileSync(from, to);
      fs.chmodSync(to, st.mode & 0o777);
    }
  }
}

const changes = {
  'a wrong golden packet': (root) => fs.writeFileSync(path.join(root, 'tests/goldens/go-search.packet.json'), '{"wrong":true}\n'),
  'a README edit': (root) => fs.appendFileSync(path.join(root, 'README.md'), '\nA later change.\n'),
  // Embeds the build directory in the binary, so builds in two directories differ.
  'a build that depends on its directory': (root) => {
    const file = path.join(root, 'src/main.rs');
    const source = fs.readFileSync(file, 'utf8');
    const head = /fn main\(\)[^{]*\{/.exec(source);
    if (!head) fail('src/main.rs has no fn main() to change');
    const at = head.index + head[0].length;
    fs.writeFileSync(
      file,
      `${source.slice(0, at)}\n    if std::env::var_os("KOGEN_CONTEXT_ACCEPTANCE_DIRECTORY").is_some() {\n        eprintln!("{}", env!("CARGO_MANIFEST_DIR"));\n    }\n${source.slice(at)}`,
    );
  },
};

function applyChange(root, change) {
  if (!changes[change]) fail(`unknown change ${JSON.stringify(change)}; known: ${Object.keys(changes).join(', ')}`);
  changes[change](root);
}

// The repository's observable Git state: status (ignored paths excluded), HEAD and tags.
function gitState(root) {
  return {
    status: git(root, ['status', '--porcelain=v1', '--untracked-files=all']),
    head: commitOf(root, 'HEAD'),
    tags: git(root, ['tag', '--list']),
  };
}

// Replaces {platform}, {head} and {tag:NAME} with the host platform, the
// copy's HEAD commit and the commit that tag NAME points to.
function expand(world, root, text) {
  return text
    .replace(/\{platform\}/g, () => state(world).platform || fail('the host platform was not resolved by an earlier step'))
    .replace(/\{head\}/g, () => commitOf(root, 'HEAD'))
    .replace(/\{tag:([^}]+)\}/g, (_, tag) => commitOf(root, tag));
}

function result(world) {
  const r = state(world).result;
  if (!r) fail('no command was run by an earlier step');
  return r;
}

function describe(r) {
  return `${r.what} (status ${r.status}, signal ${r.signal}, error ${r.error})\nstdout: ${JSON.stringify(r.stdout)}\nstderr: ${JSON.stringify(r.stderr)}`;
}

function record(world, what, root, r) {
  state(world).result = { what, root, status: r.status, signal: r.signal, error: r.error, stdout: r.stdout, stderr: r.stderr };
}

Given(/^k-context-release-binaries: the build host platforms$/, function (table) {
  const r = spawnSync('rustc', ['-vV'], { cwd: repoRoot, env: baseEnv(), encoding: 'utf8', timeout: commandTimeout });
  if (r.status !== 0) fail(`rustc -vV failed in ${repoRoot} (status ${r.status}, error ${r.error}):\n${r.stdout}${r.stderr}`);
  const host = (/^host: (.+)$/m.exec(r.stdout) || [])[1];
  const row = table.hashes().find((h) => h['host triple'] === host);
  if (!row) fail(`the host triple ${JSON.stringify(host)} is not a build host platform in the table`);
  state(this).platform = row.platform;
});

Given(P + 'a committed copy {string} of the working tree at {string}', { timeout: stepTimeout }, function (name, rel) {
  const root = path.join(temp(this), rel);
  copyTree(repoRoot, root);
  git(root, ['init', '-q']);
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'Release candidate']);
  state(this).copies[name] = root;
});

Given(P + 'copy {string} commits {string}', function (name, change) {
  const root = copyRoot(this, name);
  applyChange(root, change);
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', change]);
});

Given(P + 'copy {string} has the uncommitted change {string}', function (name, change) {
  applyChange(copyRoot(this, name), change);
});

Given(P + 'copy {string} has the annotated tag {string} on HEAD', function (name, tag) {
  git(copyRoot(this, name), ['tag', '-a', '-m', tag, tag]);
});

Given(P + 'copy {string} has the file {string}', function (name, rel) {
  const file = path.join(copyRoot(this, name), rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, 'stale\n');
});

When(
  /^k-context-release-binaries: I run "([^"]*)" with arguments (\[.*\]) in copy "([^"]*)"$/,
  { timeout: stepTimeout },
  function (script, args, name) {
    const root = copyRoot(this, name);
    const argv = JSON.parse(args);
    const before = gitState(root);
    const r = spawnSync(path.join(root, script), argv, {
      cwd: root,
      env: baseEnv(),
      encoding: 'utf8',
      timeout: commandTimeout,
    });
    record(this, `${script} ${JSON.stringify(argv)} in copy ${JSON.stringify(name)}`, root, r);
    state(this).result.gitBefore = before;
    state(this).result.gitAfter = gitState(root);
  },
);

When(/^k-context-release-binaries: I run the development build with arguments (\[.*\])$/, function (args) {
  const argv = JSON.parse(args);
  const r = spawnSync(devBinary, argv, { cwd: repoRoot, env: baseEnv(), encoding: 'utf8', timeout: 30000 });
  record(this, `${devBinary} ${JSON.stringify(argv)}`, repoRoot, r);
});

When(
  P + 'I run the corpus test in copy {string} with KOGEN_CONTEXT_BIN naming a stub that prints {string}',
  { timeout: stepTimeout },
  function (name, text) {
    const root = copyRoot(this, name);
    const stub = path.join(temp(this), 'stub.sh');
    fs.writeFileSync(stub, `#!/bin/sh\ncat >/dev/null\nprintf '%s\\n' '${text}'\n`);
    fs.chmodSync(stub, 0o755);
    const args = ['test', '--locked', '--offline', '--test', 'corpus'];
    const r = spawnSync('cargo', args, {
      cwd: root,
      env: { ...baseEnv(), CARGO_TARGET_DIR: path.join(root, 'target'), KOGEN_CONTEXT_BIN: stub },
      encoding: 'utf8',
      timeout: commandTimeout,
    });
    record(this, `KOGEN_CONTEXT_BIN=${stub} cargo ${args.join(' ')} in copy ${JSON.stringify(name)}`, root, r);
  },
);

Then(/^k-context-release-binaries: it exits with status (\d+), stdout (".*") and stderr (".*")$/, function (status, stdout, stderr) {
  const r = result(this);
  const problems = [];
  if (r.status !== Number(status)) problems.push(`exit status: expected ${status}`);
  const out = expand(this, r.root, JSON.parse(stdout));
  const err = expand(this, r.root, JSON.parse(stderr));
  if (r.stdout !== out) problems.push(`stdout: expected ${JSON.stringify(out)}`);
  if (r.stderr !== err) problems.push(`stderr: expected ${JSON.stringify(err)}`);
  if (problems.length) fail(`${problems.join('\n')}\nactual: ${describe(r)}`);
});

Then(/^k-context-release-binaries: it exits with status (\d+), empty stdout and the single stderr line (".*")$/, function (status, line) {
  const r = result(this);
  const problems = [];
  if (r.status !== Number(status)) problems.push(`exit status: expected ${status}`);
  const err = `${expand(this, r.root, JSON.parse(line))}\n`;
  if (r.stdout !== '') problems.push('stdout: expected ""');
  if (r.stderr !== err) problems.push(`stderr: expected ${JSON.stringify(err)}`);
  if (problems.length) fail(`${problems.join('\n')}\nactual: ${describe(r)}`);
});

Then(P + 'it exits with status {int}', function (status) {
  const r = result(this);
  if (r.status !== status) fail(`exit status: expected ${status}\nactual: ${describe(r)}`);
});

Then(P + 'it exits with a status other than 0', function () {
  const r = result(this);
  if (r.status === 0 || r.status === null) fail(`expected a nonzero exit status\nactual: ${describe(r)}`);
});

Then(/^k-context-release-binaries: stdout matches (".*")$/, function (pattern) {
  const r = result(this);
  const source = expand(this, r.root, JSON.parse(pattern));
  if (!new RegExp(source).test(r.stdout)) fail(`stdout does not match ${JSON.stringify(source)}\nactual: ${describe(r)}`);
});

Then(/^k-context-release-binaries: stderr has the line (".*")$/, function (line) {
  const r = result(this);
  const expected = expand(this, r.root, JSON.parse(line));
  if (!r.stderr.split('\n').includes(expected)) fail(`stderr has no line ${JSON.stringify(expected)}\nactual: ${describe(r)}`);
});

Then(/^k-context-release-binaries: its output contains (".*")$/, function (text) {
  const r = result(this);
  const expected = expand(this, r.root, JSON.parse(text));
  if (!`${r.stdout}${r.stderr}`.includes(expected)) fail(`stdout and stderr do not contain ${JSON.stringify(expected)}\nactual: ${describe(r)}`);
});

Then(P + 'the command left the Git status, HEAD and tags of copy {string} unchanged', function (name) {
  const r = result(this);
  if (r.root !== copyRoot(this, name)) fail(`the last command did not run in copy ${JSON.stringify(name)}`);
  for (const key of ['status', 'head', 'tags']) {
    expectEqual(r.gitAfter[key], r.gitBefore[key], `${key} of copy ${JSON.stringify(name)} changed during ${r.what}`);
  }
});

Then(P + 'copy {string} has no {string}', function (name, rel) {
  if (fs.lstatSync(path.join(copyRoot(this, name), rel), { throwIfNoEntry: false })) {
    fail(`${rel} exists in copy ${JSON.stringify(name)}, after ${describe(result(this))}`);
  }
});

Then(
  P + 'copy {string} holds the release artifacts of {string} for the host platform, and stdout is their SHA256SUMS',
  function (name, tag) {
    const r = result(this);
    const dir = path.join(copyRoot(this, name), releaseDir, tag);
    const problems = checkArtifacts(dir, tag, state(this).platform, r.stdout);
    if (problems.length) fail(`${releaseDir}/${tag} in copy ${JSON.stringify(name)}:\n${problems.join('\n')}\nafter: ${describe(r)}`);
  },
);

function artifact(world, name, tag) {
  return path.join(copyRoot(world, name), releaseDir, tag, artifactName(tag, state(world).platform));
}

Then(
  /^k-context-release-binaries: the artifact of "([^"]*)" in copy "([^"]*)" prints (".*") for arguments (\[.*\])$/,
  function (tag, name, stdout, args) {
    const root = copyRoot(this, name);
    const bin = artifact(this, name, tag);
    const r = spawnSync(bin, JSON.parse(args), { cwd: root, env: baseEnv(), encoding: 'utf8', timeout: 30000 });
    const expected = expand(this, root, JSON.parse(stdout));
    if (r.status !== 0 || r.stdout !== expected || r.stderr !== '') {
      fail(`${bin} ${args}: expected status 0, stdout ${JSON.stringify(expected)} and empty stderr\nactual: status ${r.status}, error ${r.error}, stdout ${JSON.stringify(r.stdout)}, stderr ${JSON.stringify(r.stderr)}`);
    }
  },
);

Then(
  P + 'the artifact of {string} in copy {string} prints the golden packet {string} for its request',
  function (tag, name, golden) {
    const root = copyRoot(this, name);
    const bin = artifact(this, name, tag);
    const request = fs.readFileSync(path.join(repoRoot, 'tests/goldens', `${golden}.request.json`));
    const packet = fs.readFileSync(path.join(repoRoot, 'tests/goldens', `${golden}.packet.json`), 'utf8');
    const r = spawnSync(bin, ['request'], { cwd: root, input: request, env: baseEnv(), encoding: 'utf8', timeout: 30000 });
    if (r.status !== 0 || r.stdout !== packet || r.stderr !== '') {
      fail(`${bin} request < tests/goldens/${golden}.request.json in copy ${JSON.stringify(name)}: expected status 0, stdout ${JSON.stringify(packet)} and empty stderr\nactual: status ${r.status}, error ${r.error}, stdout ${JSON.stringify(r.stdout)}, stderr ${JSON.stringify(r.stderr)}`);
    }
  },
);

Then(
  P + 'copies {string} and {string} have the same commit for {string} and byte-identical artifacts',
  function (first, second, tag) {
    const a = copyRoot(this, first);
    const b = copyRoot(this, second);
    expectEqual(commitOf(b, tag), commitOf(a, tag), `the commit of ${tag} differs between the copies`);
    const name = artifactName(tag, state(this).platform);
    for (const file of ['SHA256SUMS', name]) {
      const x = fs.readFileSync(path.join(a, releaseDir, tag, file));
      const y = fs.readFileSync(path.join(b, releaseDir, tag, file));
      if (!x.equals(y)) {
        const hash = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
        fail(`${releaseDir}/${tag}/${file} differs: copy ${JSON.stringify(first)} sha256 ${hash(x)}, copy ${JSON.stringify(second)} sha256 ${hash(y)}`);
      }
    }
  },
);

Then(/^k-context-release-binaries: README.md contains (".*")$/, function (text) {
  const expected = JSON.parse(text);
  const readme = fs.readFileSync(path.join(repoRoot, 'README.md'), 'utf8');
  if (!readme.includes(expected)) fail(`README.md does not contain ${JSON.stringify(expected)}`);
});
