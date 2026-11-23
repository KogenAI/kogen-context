'use strict';

// Steps of the Intent read-distinguishes-io-errors-from-non-text. They run the
// kogen-context binary that Cargo builds, with `read` on temporary fixtures.

const { After, BeforeAll, Given, Then, When } = require('@cucumber/cucumber');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const P = 'read-distinguishes-io-errors-from-non-text: ';
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

function checkout(world) {
  world.parent = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kogen-context-')));
  world.root = path.join(world.parent, 'checkout');
  fs.mkdirSync(world.root);
}

function describe(world) {
  const r = world.result;
  return `${binary} ${r.args.join(' ')} (status ${r.status}, signal ${r.signal}), stdout ${JSON.stringify(r.stdout)}, stderr ${JSON.stringify(r.stderr)}`;
}

function refusal(world) {
  const r = world.result;
  let parsed;
  try {
    parsed = JSON.parse(r.stderr);
  } catch (error) {
    assert.fail(`stderr is not one JSON refusal: ${describe(world)}`);
  }
  assert.ok(parsed && parsed.error, `stderr has no error object: ${describe(world)}`);
  return parsed.error;
}

Given(P + 'a checkout holding the file {string} with the bytes {string} in hexadecimal', function (name, hex) {
  checkout(this);
  fs.writeFileSync(path.join(this.root, name), Buffer.from(hex, 'hex'));
});

Given(P + 'a checkout holding the file {string} with the text {string}', function (name, text) {
  checkout(this);
  fs.writeFileSync(path.join(this.root, name), text.replace(/\\n/g, '\n'));
});

Given(P + 'a checkout holding the file {string} with the text {string} that its owner cannot read', function (name, text) {
  checkout(this);
  const file = path.join(this.root, name);
  fs.writeFileSync(file, text.replace(/\\n/g, '\n'));
  fs.chmodSync(file, 0o000);
  let readable = true;
  try {
    fs.accessSync(file, fs.constants.R_OK);
  } catch (error) {
    readable = false;
  }
  assert.equal(readable, false, `${file} with mode 000 is still readable by this process (root?); the open failure cannot be injected`);
});

When(P + 'kogen-context read is run with the root {string} and the path {string} from line {int} to {int}', function (root, file, start, end) {
  const args = ['read', root === '<checkout>' ? this.root : root, file, String(start), String(end)];
  const r = spawnSync(binary, args, { encoding: 'utf8', timeout: 60000 });
  assert.equal(r.error, undefined, `${binary} ${args.join(' ')} could not run: ${r.error}`);
  this.result = { args, status: r.status, signal: r.signal, stdout: r.stdout, stderr: r.stderr };
});

Then(P + 'the refusal code is {string}', function (code) {
  assert.equal(refusal(this).code, code, describe(this));
});

Then(P + 'the refusal code is not {string}', function (code) {
  const actual = refusal(this).code;
  assert.equal(typeof actual, 'string', describe(this));
  assert.ok(actual.length > 0, `empty refusal code: ${describe(this)}`);
  assert.notEqual(actual, code, describe(this));
});

Then(P + 'the refusal message names the path {string}', function (file) {
  const message = String(refusal(this).message);
  assert.ok(message.includes(file), `message ${JSON.stringify(message)} does not name ${file}: ${describe(this)}`);
});

Then(P + 'the refusal message does not say the file is not UTF-8 text', function () {
  const message = String(refusal(this).message);
  assert.ok(!message.includes('not UTF-8 text'), `message ${JSON.stringify(message)} blames the encoding: ${describe(this)}`);
});

Then(P + 'the exit status is {int}', function (status) {
  assert.equal(this.result.status, status, describe(this));
});

Then(P + 'the packet total_lines is {int}', function (total) {
  let packet;
  try {
    packet = JSON.parse(this.result.stdout);
  } catch (error) {
    assert.fail(`stdout is not a JSON packet: ${describe(this)}`);
  }
  assert.equal(packet.total_lines, total, describe(this));
});

Then(P + 'the packet lines are {string}', function (expected) {
  const packet = JSON.parse(this.result.stdout);
  const actual = packet.lines.map((l) => `${l.line}:${l.text}`).join(',');
  assert.equal(actual, expected, describe(this));
});
