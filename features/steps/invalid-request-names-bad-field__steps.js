'use strict';

// Steps of the Intent invalid-request-names-bad-field. They run the
// kogen-context binary that Cargo builds, send one request on standard input
// and judge the one packet it writes.

const { After, BeforeAll, Then, When } = require('@cucumber/cucumber');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const P = 'invalid-request-names-bad-field: ';
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
  this.result = undefined;
});

function describe(world) {
  const r = world.result;
  return `kogen-context request with stdin ${JSON.stringify(r.request)} (status ${r.status}, signal ${r.signal}), stdout ${JSON.stringify(r.stdout)}, stderr ${JSON.stringify(r.stderr)}`;
}

function packet(world) {
  const r = world.result;
  assert.ok(r.stdout.endsWith('\n') && r.stdout.indexOf('\n') === r.stdout.length - 1, `stdout is not exactly one line: ${describe(world)}`);
  return JSON.parse(r.stdout);
}

function errorOf(world) {
  const p = packet(world);
  assert.equal(p.version, 1, describe(world));
  assert.ok(p.error && typeof p.error.message === 'string', `no error packet: ${describe(world)}`);
  return p.error;
}

When(P + 'kogen-context request is run with the following request on standard input', function (request) {
  const r = spawnSync(binary, ['request'], {
    cwd: repoRoot,
    input: request,
    encoding: 'utf8',
    timeout: 60000,
  });
  assert.equal(r.error, undefined, `kogen-context request could not run: ${r.error}`);
  this.result = { request, status: r.status, signal: r.signal, stdout: r.stdout, stderr: r.stderr };
});

Then(P + 'the exit status is exactly {int}', function (status) {
  assert.equal(this.result.status, status, describe(this));
});

Then(P + 'standard error is empty', function () {
  assert.equal(this.result.stderr, '', describe(this));
});

Then(P + 'the packet is an error packet with the code {string}', function (code) {
  assert.equal(errorOf(this).code, code, describe(this));
});

Then(P + 'the error message contains {string}', function (text) {
  assert.ok(errorOf(this).message.includes(text), `message lacks ${JSON.stringify(text)}: ${describe(this)}`);
});

Then(P + 'the error message does not contain {string}', function (text) {
  assert.ok(!errorOf(this).message.includes(text), `message contains ${JSON.stringify(text)}: ${describe(this)}`);
});

Then(P + 'the error message is exactly {string}', function (text) {
  assert.equal(errorOf(this).message, text, describe(this));
});

Then(P + 'the packet is a search packet without an error member', function () {
  const p = packet(this);
  assert.equal(p.version, 1, describe(this));
  assert.equal(p.operation, 'search', describe(this));
  assert.equal(p.error, undefined, describe(this));
});
