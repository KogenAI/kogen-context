'use strict';

const { Given, When, Then, After } = require('@cucumber/cucumber');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const prefix = 'skip-linked-worktree-git-file: ';
const repo = path.resolve(__dirname, '..', '..');
const target = process.env.CARGO_TARGET_DIR
  ? path.resolve(repo, process.env.CARGO_TARGET_DIR)
  : path.join(repo, 'target');
let built = false;

Given(prefix + 'a checkout with these files', function (table) {
  this.skipGitFixture = fs.mkdtempSync(path.join(os.tmpdir(), 'skip-git-entry-'));
  for (const row of table.hashes()) {
    const file = path.join(this.skipGitFixture, row.path);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, row.text + '\n');
  }
});

When(prefix + 'I search for {string}', { timeout: 115000 }, function (literal) {
  if (!built) {
    const build = spawnSync('cargo', ['build', '--locked', '--offline', '--bin', 'kogen-context'], {
      cwd: repo, encoding: 'utf8', timeout: 95000,
    });
    assert.equal(build.status, 0, `cargo build --locked --offline --bin kogen-context: ${build.error || ''}\n${build.stdout}${build.stderr}`);
    built = true;
  }
  this.skipGitResult = spawnSync(path.join(target, 'debug', 'kogen-context'),
    ['search', this.skipGitFixture, literal], {
      cwd: repo, encoding: 'utf8', timeout: 10000,
    });
});

Then(prefix + 'the search succeeds with exactly this JSON', function (expected) {
  const result = this.skipGitResult;
  assert.deepEqual({
    status: result.status,
    stderr: result.stderr,
    packet: JSON.parse(result.stdout),
  }, {
    status: 0,
    stderr: '',
    packet: JSON.parse(expected),
  }, `search ${this.skipGitFixture}: ${result.error || ''}\nstdout: ${result.stdout}\nstderr: ${result.stderr}`);
});

After(function () {
  if (this.skipGitFixture) fs.rmSync(this.skipGitFixture, { recursive: true, force: true });
});
