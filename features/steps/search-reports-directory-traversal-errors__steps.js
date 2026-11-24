'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function jsonLine(output) {
  assert.match(output, /^[^\r\n]+\n$/, 'expected exactly one JSON output line');
  return JSON.parse(output);
}

function expectRefusal(result, code, affectedPath) {
  assert.equal(result.status, 1, `expected refusal, stdout: ${result.stdout}, stderr: ${result.stderr}`);
  assert.equal(result.stdout, '', 'a refused search must not write results');
  const refusal = jsonLine(result.stderr);
  assert.deepEqual(refusal, { error: { code, message: refusal.error?.message } });
  assert.equal(typeof refusal.error.message, 'string');
  assert.ok(refusal.error.message.includes(affectedPath), `path ${affectedPath} not named in ${refusal.error.message}`);
}

function expectResults(result, expected) {
  assert.equal(result.status, 0, `expected success, stderr: ${result.stderr}`);
  assert.equal(result.stderr, '');
  assert.deepEqual(jsonLine(result.stdout), expected);
}

// Qualify the same observers without depending on the missing feature.
if (require.main === module) {
  const directory = 'app/locked';
  const error = (code, message) => ({ status: 1, stdout: '', stderr: JSON.stringify({ error: { code, message } }) + '\n' });
  const packet = { query: 'needle', matches: [
    { path: 'a.txt', line: 1, column: 1, text: 'needle' },
    { path: 'b/note.txt', line: 2, column: 1, text: 'needle' },
  ], truncated: false };
  const success = (value) => ({ status: 0, stdout: JSON.stringify(value) + '\n', stderr: '' });
  const refusal = error('io_error', `cannot enumerate directory: /checkout/${directory}: Permission denied`);
  if (process.argv[2] === 'good') {
    expectRefusal(refusal, 'io_error', directory);
    expectResults(success(packet), packet);
    console.log('search observers accepted both valid outcomes');
  } else if (process.argv[2] === 'bad') {
    for (const result of [success(packet), { ...refusal, stdout: success(packet).stdout },
      error('root_not_directory', directory), error('io_error', '/checkout/app')]) {
      assert.throws(() => expectRefusal(result, 'io_error', directory), { name: 'AssertionError' });
    }
    for (const result of [refusal, success({ ...packet, matches: [...packet.matches].reverse() }),
      success({ ...packet, matches: [...packet.matches, { path: 'secret.txt', line: 1, column: 1, text: 'needle' }] })]) {
      assert.throws(() => expectResults(result, packet), { name: 'AssertionError' });
    }
    console.log('search observers rejected all invalid outcomes');
    process.exitCode = 1;
  } else {
    throw new Error('expected observer control good or bad');
  }
} else {
  const { After, BeforeAll, Given, When, Then } = require('@cucumber/cucumber');
  const p = 'search-reports-directory-traversal-errors: ';
  const repo = path.resolve(__dirname, '..', '..');
  const target = path.resolve(repo, process.env.CARGO_TARGET_DIR || 'target');
  const binary = path.join(target, 'debug', 'kogen-context');

  BeforeAll({ timeout: 115000 }, function () {
    const build = spawnSync('cargo', ['build', '--locked', '--offline'], {
      cwd: repo, encoding: 'utf8', timeout: 110000,
    });
    assert.ifError(build.error);
    assert.equal(build.status, 0, `cargo build --locked --offline failed:\n${build.stdout}${build.stderr}`);
  });

  After(function () {
    if (!this.root) return;
    try {
      for (const [file, mode] of this.restore) fs.chmodSync(file, mode);
    } finally {
      fs.rmSync(this.root, { recursive: true, force: true });
    }
  });

  Given(p + 'a checkout with these files', function (table) {
    this.restore = [];
    this.root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kogen-search-')));
    for (const row of table.hashes()) {
      const file = path.join(this.root, row.path);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, row.text + '\n');
    }
  });

  Given(p + 'the checkout is a Git repository', function () {
    const result = spawnSync('git', ['init', '--quiet', this.root], { encoding: 'utf8', timeout: 10000 });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
  });

  Given(p + 'symlink {string} points to {string}', function (link, target) {
    fs.symlinkSync(target, path.join(this.root, link));
  });

  function deny(world, file) {
    const target = path.join(world.root, file);
    world.restore.push([target, fs.statSync(target).mode & 0o777]);
    fs.chmodSync(target, 0o000);
    return target;
  }

  Given(p + 'directory {string} cannot be enumerated', function (directory) {
    const target = deny(this, directory);
    assert.ok(fs.statSync(target).isDirectory());
    assert.doesNotThrow(() => fs.readdirSync(path.dirname(target)));
    assert.throws(() => fs.readdirSync(target), { code: 'EACCES' }, `cannot reproduce enumeration denial for ${target}; run without filesystem privilege bypass`);
  });

  Given(p + 'regular file {string} cannot be opened for reading', function (file) {
    const target = deny(this, file);
    assert.ok(fs.statSync(target).isFile());
    assert.throws(() => fs.closeSync(fs.openSync(target, 'r')), { code: 'EACCES' }, `cannot reproduce open denial for ${target}; run without filesystem privilege bypass`);
  });

  Given(p + 'file {string} contains invalid UTF-8 followed by {string}', function (file, literal) {
    fs.writeFileSync(path.join(this.root, file), Buffer.concat([Buffer.from([0xff]), Buffer.from(` ${literal}\n`)]));
  });

  When(p + 'kogen-context search runs in that checkout for {string}', function (literal) {
    this.result = spawnSync(binary, ['search', this.root, literal], { encoding: 'utf8', timeout: 10000 });
    assert.ifError(this.result.error);
  });

  When(p + 'kogen-context read runs in that checkout for {string} at line 1', function (file) {
    this.result = spawnSync(binary, ['read', this.root, file, '1', '1'], { encoding: 'utf8', timeout: 10000 });
    assert.ifError(this.result.error);
  });

  Then(p + 'read refuses with {string} naming {string} and no results', function (code, file) {
    expectRefusal(this.result, code, file);
  });

  Then(p + 'search refuses with {string} naming {string} and no results', function (code, directory) {
    expectRefusal(this.result, code, directory);
  });

  Then(p + 'search succeeds with exactly this result', function (expected) {
    expectResults(this.result, JSON.parse(expected));
  });
}
