'use strict';

const { After, BeforeAll, Given, Then, When } = require('@cucumber/cucumber');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const P = 'rank-recognizes-php-hash-comments: ';
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
  if (this.rphpDir) fs.rmSync(this.rphpDir, { recursive: true, force: true });
});

Given(P + 'a PHP file {string} containing the lines:', function (name, doc) {
  this.rphpDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kogen-context-rank-php-')));
  fs.writeFileSync(path.join(this.rphpDir, name), `${doc}\n`);
});

When(P + 'I run a ranked search for {string}', function (literal) {
  const request = JSON.stringify({
    version: 1,
    root: this.rphpDir,
    operation: 'search',
    literal,
    order: 'ranked',
    limits: { max_matches: 20 },
  });
  const r = spawnSync(binary, ['request'], { input: request, encoding: 'utf8', timeout: 60000 });
  assert.equal(r.status, 0, `${binary} request exited ${r.status} (signal ${r.signal}, error ${r.error}): ${r.stdout}${r.stderr}`);
  this.rphpPacket = JSON.parse(r.stdout);
});

Then(P + 'the matches are on lines {string} in that order', function (expected) {
  assert.equal(this.rphpPacket.operation, 'search', `unexpected packet: ${JSON.stringify(this.rphpPacket)}`);
  const lines = this.rphpPacket.matches.map((m) => m.line).join(', ');
  assert.equal(lines, expected, `ranked match lines; packet: ${JSON.stringify(this.rphpPacket.matches)}`);
});
