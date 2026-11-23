'use strict';

// Steps of the Intent utf8-four-byte-boundary-test. read_utf8_blocks is private, so
// the steps judge the unit tests of src/main.rs by mutation: each mutant is a copy
// of the Rust sources with one wrong change to the retained-bytes handling, and the
// unit tests (`cargo test --bin kogen-context`) must fail on it. The tests that the
// Build adds are the only thing that can make the four-byte mutants fail.

const { After, Given, Then } = require('@cucumber/cucumber');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const P = 'utf8-four-byte-boundary-test: ';
const repoRoot = path.resolve(__dirname, '..', '..');

const ANCHOR = 'pending = end - valid_end;';
const EOF_REFUSAL = `                return if pending == 0 {
                    Ok(text)
                } else {
                    Err(ReadFailure::NotText)
                };`;

// Each mutant replaces one exact piece of src/main.rs with a wrong one.
const MUTANTS = {
  'drops the leading byte of a retained four-byte character': [
    ANCHOR,
    'pending = if end - valid_end == 1 && buffer[0] >= 0xf0 { 0 } else { end - valid_end };',
  ],
  'retains one byte of two incomplete bytes': [ANCHOR, 'pending = match end - valid_end { 2 => 1, n => n };'],
  'retains two bytes of three incomplete bytes': [ANCHOR, 'pending = match end - valid_end { 3 => 2, n => n };'],
  'accepts an incomplete final character as complete text': [EOF_REFUSAL, '                return Ok(text);'],
};

After(function () {
  if (this.copy) fs.rmSync(this.copy, { recursive: true, force: true });
});

Given(P + 'a copy of the Rust sources', function () {
  this.copy = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kogen-context-utf8-')));
  fs.cpSync(path.join(repoRoot, 'src'), path.join(this.copy, 'src'), { recursive: true });
  for (const f of ['Cargo.toml', 'Cargo.lock', 'rust-toolchain.toml']) {
    fs.copyFileSync(path.join(repoRoot, f), path.join(this.copy, f));
  }
});

function runUnitTests(world, mutant) {
  if (mutant !== undefined) {
    assert.ok(MUTANTS[mutant], `unknown mutant "${mutant}"`);
    const [from, to] = MUTANTS[mutant];
    const file = path.join(world.copy, 'src', 'main.rs');
    const parts = fs.readFileSync(file, 'utf8').split(from);
    assert.equal(parts.length, 2, `mutant "${mutant}" found its anchor ${parts.length - 1} times in src/main.rs, expected once`);
    fs.writeFileSync(file, parts.join(to));
  }
  const args = ['test', '--locked', '--offline', '--bin', 'kogen-context'];
  const r = spawnSync('cargo', args, {
    cwd: world.copy,
    encoding: 'utf8',
    timeout: 100000,
    env: { ...process.env, CARGO_TARGET_DIR: path.join(os.tmpdir(), 'kogen-context-utf8-target') },
  });
  const where = `cargo ${args.join(' ')} in ${world.copy} (status ${r.status}, signal ${r.signal}, error ${r.error})`;
  return { r, where };
}

Then(P + 'the unit tests pass on the unchanged sources', function () {
  const { r, where } = runUnitTests(this);
  assert.ok(r.status === 0 && /test result: ok\./.test(r.stdout), `${where} did not pass:\n${r.stdout}${r.stderr}`);
});

Then(P + 'the unit tests reject the mutant {string}', function (mutant) {
  const { r, where } = runUnitTests(this, mutant);
  assert.ok(
    r.status !== 0 && /test result: FAILED\./.test(r.stdout),
    `mutant "${mutant}" survived: ${where} reported no failing unit test:\n${r.stdout}${r.stderr}`,
  );
});
