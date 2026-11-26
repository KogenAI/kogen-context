'use strict';

const { After, Given, Then, When } = require('@cucumber/cucumber');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const assertOrder = require('./rank-recognizes-kotlin-function-definitions__observe.js');

const prefix = 'rank-recognizes-kotlin-function-definitions: ';
const repo = path.resolve(__dirname, '..', '..');
const target = path.resolve(repo, process.env.CARGO_TARGET_DIR || 'target');
let built = false;

function run(command, args, options) {
  const result = spawnSync(command, args, { cwd: repo, encoding: 'utf8', ...options });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, `${command} ${args.join(' ')}: ${result.stdout}${result.stderr}`);
  return result.stdout;
}

After(function () {
  if (this.kotlinRankRoot) fs.rmSync(this.kotlinRankRoot, { recursive: true, force: true });
});

Given(prefix + 'a Kotlin file {string} containing:', function (filename, content) {
  this.kotlinRankRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kogen-kotlin-rank-'));
  fs.writeFileSync(path.join(this.kotlinRankRoot, filename), `${content}\n`);
});

When(prefix + 'I run a ranked search for {string}', { timeout: 115000 }, function (literal) {
  if (!built) {
    run('cargo', ['build', '--locked', '--offline', '--bin', 'kogen-context'], { timeout: 100000 });
    built = true;
  }
  this.kotlinRankPacket = JSON.parse(run(path.join(target, 'debug', 'kogen-context'), ['request'], {
    timeout: 10000,
    input: JSON.stringify({ version: 1, root: this.kotlinRankRoot, operation: 'search', literal, order: 'ranked' }),
  }));
});

Then(prefix + 'the matching lines of {string} are {string} in that order', function (filename, lines) {
  assertOrder(this.kotlinRankPacket, filename, lines);
});
