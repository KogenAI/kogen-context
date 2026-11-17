'use strict';

// Steps of the Intent stdout-write-failure-exits-without-panic. They run the
// kogen-context binary that Cargo builds, with standard output on /dev/full.

const { After, BeforeAll, Given, Then, When } = require('@cucumber/cucumber');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const P = 'stdout-write-failure-exits-without-panic: ';
const repoRoot = path.resolve(__dirname, '..', '..');
const targetDir = process.env.CARGO_TARGET_DIR
  ? path.resolve(repoRoot, process.env.CARGO_TARGET_DIR)
  : path.join(repoRoot, 'target');
const binary = path.join(targetDir, 'debug', 'kogen-context');
const buildCommand = ['cargo', 'build', '--locked', '--offline', '--bin', 'kogen-context'];

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
  if (this.parent) fs.rmSync(this.parent, { recursive: true, force: true });
});

function runOnFull(world, args, input) {
  assert.ok(fs.existsSync('/dev/full'), '/dev/full does not exist on this host');
  const fd = fs.openSync('/dev/full', 'w');
  try {
    const r = spawnSync(binary, args, {
      input,
      stdio: [input === undefined ? 'ignore' : 'pipe', fd, 'pipe'],
      timeout: 60000,
    });
    assert.equal(r.error, undefined, `${binary} ${args.join(' ')} could not run: ${r.error}`);
    world.result = { args, status: r.status, signal: r.signal, stderr: r.stderr.toString('utf8') };
  } finally {
    fs.closeSync(fd);
  }
}

function describe(world) {
  const r = world.result;
  return `kogen-context ${r.args.join(' ')} with stdout on /dev/full (status ${r.status}, signal ${r.signal}), stderr ${JSON.stringify(r.stderr)}`;
}

Given(P + 'a checkout holding the file {string} with the text {string}', function (name, text) {
  this.parent = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kogen-context-')));
  this.root = path.join(this.parent, 'checkout');
  fs.mkdirSync(this.root);
  fs.writeFileSync(path.join(this.root, name), text);
});

Given(P + 'the request text that searches that checkout for {string}', function (literal) {
  this.requestText = `{"version":1,"root":"${this.root}","operation":"search","literal":"${literal}"}`;
});

When(P + 'kogen-context request is run with that request text on standard input and standard output on \\/dev\\/full', function () {
  runOnFull(this, ['request'], this.requestText);
});

When(P + 'kogen-context is run with the arguments {string} and standard output on \\/dev\\/full', function (args) {
  runOnFull(this, args.split(' ').map((a) => (a === '<root>' ? this.root : a)));
});

Then(P + 'the exit status is exactly {int}', function (status) {
  assert.equal(this.result.status, status, describe(this));
});

Then(P + 'standard error is empty', function () {
  assert.equal(this.result.stderr, '', describe(this));
});

Then(P + 'standard error is exactly the following line', function (line) {
  assert.equal(this.result.stderr, `${line}\n`, describe(this));
});

Then(P + 'the Invocation section of {string} contains the sentence {string}', function (file, sentence) {
  const text = fs.readFileSync(path.join(repoRoot, file), 'utf8');
  const start = text.indexOf('## Invocation');
  assert.notEqual(start, -1, `${file} has no Invocation section`);
  const next = text.indexOf('\n## ', start + 1);
  const section = text.slice(start, next === -1 ? undefined : next);
  assert.ok(section.includes(sentence), `${file} Invocation section lacks ${JSON.stringify(sentence)}:\n${section}`);
});
