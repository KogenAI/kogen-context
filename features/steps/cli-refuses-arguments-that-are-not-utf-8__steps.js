'use strict';

// Steps of the Intent cli-refuses-arguments-that-are-not-utf-8. They run the
// kogen-context binary that Cargo builds. Node cannot pass an argument that is
// not valid UTF-8 to a child process, so each run goes through `sh`, which
// builds such an argument with printf from octal escapes.

const { After, BeforeAll, Given, Then, When } = require('@cucumber/cucumber');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const P = 'cli-refuses-arguments-that-are-not-utf-8: ';
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

function quote(text) {
  return `'${text.replace(/'/g, `'\\''`)}'`;
}

// One shell word for an argument token: `hex:HH..` is the bytes of the hex
// digits, `<root>` the checkout root, `<missing-root>` a directory below it
// that does not exist, anything else itself.
function word(world, token) {
  if (token === '<root>') return quote(world.root);
  if (token === '<missing-root>') return quote(path.join(world.root, 'missing'));
  if (token.startsWith('hex:')) {
    const hex = token.slice(4);
    assert.match(hex, /^([0-9a-f]{2})+$/, `bad hex argument ${token}`);
    const octal = hex.match(/../g).map((b) => '\\' + parseInt(b, 16).toString(8).padStart(3, '0'));
    return `"$(printf '${octal.join('')}')"`;
  }
  return quote(token);
}

Given(P + 'a checkout holding the file {string} with the bytes {string}', function (name, hex) {
  assert.match(hex, /^([0-9a-f]{2})*$/, `bad hex ${hex}`);
  this.parent = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kogen-context-')));
  this.root = path.join(this.parent, 'checkout');
  const file = path.join(this.root, name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.from(hex, 'hex'));
});

When(P + 'kogen-context is run with the arguments {string}', function (args) {
  const words = args.split(' ').map((t) => word(this, t));
  const script = `exec ${quote(binary)} ${words.join(' ')}`;
  const r = spawnSync('sh', ['-c', script], { timeout: 60000 });
  assert.equal(r.error, undefined, `${script} could not run: ${r.error}`);
  this.result = { args, status: r.status, signal: r.signal, stdout: r.stdout, stderr: r.stderr };
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

Then(P + 'standard error is exactly the following line', function (line) {
  assert.equal(this.result.stderr.toString('utf8'), `${line}\n`, describe(this));
});

Then(P + 'standard error is empty', function () {
  assert.equal(this.result.stderr.length, 0, describe(this));
});

Then(P + 'standard output is exactly the following line', function (line) {
  assert.equal(this.result.stdout.toString('utf8'), `${line}\n`, describe(this));
});
