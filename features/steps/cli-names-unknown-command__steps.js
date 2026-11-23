'use strict';

// Steps of the Intent cli-names-unknown-command. They run the
// kogen-context binary that Cargo builds on a temporary checkout.

const { After, BeforeAll, Given, Then, When } = require('@cucumber/cucumber');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const P = 'cli-names-unknown-command: ';
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

Given(P + 'a checkout holding the file {string} with the text {string}', function (name, text) {
  this.parent = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kogen-context-')));
  this.root = path.join(this.parent, 'checkout');
  const file = path.join(this.root, name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  // The feature writes a newline as the two characters backslash and n.
  fs.writeFileSync(file, text.replace(/\\n/g, '\n'));
});

function runBinary(world, label, list) {
  const r = spawnSync(binary, list, { timeout: 60000 });
  assert.equal(r.error, undefined, `${binary} ${label} could not run: ${r.error}`);
  world.result = { args: label, status: r.status, signal: r.signal, stdout: r.stdout, stderr: r.stderr };
}

When(P + 'kogen-context is run with the arguments {string}', function (args) {
  runBinary(this, args, args.split(' ').map((t) => (t === '<root>' ? this.root : t)));
});

When(P + 'kogen-context is run with no arguments', function () {
  runBinary(this, '(no arguments)', []);
});

function describe(world) {
  const r = world.result;
  return `kogen-context ${r.args} (status ${r.status}, signal ${r.signal}), stdout ${JSON.stringify(r.stdout.toString('utf8'))}, stderr ${JSON.stringify(r.stderr.toString('utf8'))}`;
}

Then(P + 'the exit status is exactly {int}', function (status) {
  assert.equal(this.result.status, status, describe(this));
});

Then(P + 'standard output is empty', function () {
  assert.equal(this.result.stdout.length, 0, describe(this));
});

Then(P + 'standard error is empty', function () {
  assert.equal(this.result.stderr.length, 0, describe(this));
});

Then(P + 'standard output is exactly the following text', function (text) {
  assert.equal(this.result.stdout.toString('utf8'), `${text}\n`, describe(this));
});

Then(P + 'standard error is exactly the following line', function (line) {
  assert.equal(this.result.stderr.toString('utf8'), `${line}\n`, describe(this));
});
