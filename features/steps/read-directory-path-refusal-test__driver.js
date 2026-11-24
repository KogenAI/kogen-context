'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '../..');
const directory = '            "not_a_file",\n            format!("not a regular file: {path}"),';
const mutations = {
  'changed refusal code': [directory, directory.replace('"not_a_file"', '"io_error"')],
  'omitted supplied path': [directory, '            "not_a_file",\n            "not a regular file".to_owned(),'],
  'wrong directory status': ['ExitCode::from(refusal.exit_status())', 'ExitCode::from(if refusal.code == "not_a_file" { 0 } else { refusal.exit_status() })'],
  'directory stdout leak': [directory, '            { println!("unexpected output"); "not_a_file" },\n            format!("not a regular file: {path}"),'],
  'changed regular-file lines': ['json_string(clip(lines[number - 1], max_chars))', 'json_string(clip(if lines[number - 1].is_empty() { "changed empty line" } else { "changed line" }, max_chars))'],
};
function copy() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'read-directory-refusal-'));
  for (const f of ['Cargo.toml', 'Cargo.lock', 'rust-toolchain.toml', 'src']) {
    fs.cpSync(path.join(root, f), path.join(dir, f), { recursive: true });
  }
  fs.mkdirSync(path.join(dir, 'tests'));
  fs.copyFileSync(path.join(root, 'tests/cli.rs'), path.join(dir, 'tests/cli.rs'));
  return dir;
}
function run(dir, mutation) {
  const file = path.join(dir, 'src/main.rs');
  const original = fs.readFileSync(file, 'utf8');
  if (mutation !== 'unchanged') {
    assert.ok(Object.hasOwn(mutations, mutation), `unknown mutation: ${mutation}`);
    const [from, to] = mutations[mutation];
    assert.equal(original.split(from).length, 2, `expected one source anchor for ${mutation}`);
    fs.writeFileSync(file, original.replace(from, to));
  }
  try {
    const args = ['test', '--locked', '--offline', '--test', 'cli', '--', '--nocapture'];
    const r = spawnSync('cargo', args, {
      cwd: dir, encoding: 'utf8', timeout: 100000,
      env: { ...process.env, CARGO_TARGET_DIR: path.join(dir, 'target') },
    });
    const detail = `cargo ${args.join(' ')} (${mutation}), status=${r.status}, signal=${r.signal}, error=${r.error}\n${r.stdout || ''}${r.stderr || ''}`;
    assert.equal(r.error, undefined, detail);
    assert.equal(r.signal, null, detail);
    assert.match(r.stdout, /running [1-9][0-9]* tests?\n/, detail);
    if (mutation === 'unchanged') {
      assert.equal(r.status, 0, detail);
      assert.match(r.stdout, /test result: ok\. [1-9][0-9]* passed; 0 failed;/, detail);
    } else {
      assert.notEqual(r.status, 0, `cli tests did not reject ${mutation}: ${detail}`);
      assert.match(r.stdout, /test result: FAILED\. [0-9]+ passed; [1-9][0-9]* failed;/, detail);
    }
  } finally {
    fs.writeFileSync(file, original);
  }
}
module.exports = { copy, run };

// Qualify these exact observer bytes using executable implementation controls.
// Normal acceptance never reads controls.json or replaces the candidate tests.
if (require.main === module) {
  const controls = JSON.parse(fs.readFileSync(path.join(root, '.kogen/intents/read-directory-path-refusal-test/controls.json'), 'utf8'));
  const fixture = process.argv[2];
  assert.ok(fixture === 'good' || fixture === 'bad', 'expected good or bad');
  const dir = copy();
  try {
    const files = fixture === 'good' ? controls.correct.files : controls.wrong.find(w => w.name === 'status-only directory check').files;
    fs.writeFileSync(path.join(dir, 'tests/cli.rs'), files['tests/cli.rs']);
    run(dir, 'unchanged');
    for (const mutation of Object.keys(mutations)) run(dir, mutation);
    process.stdout.write('observer accepted all controls\n');
  } catch (error) {
    process.stdout.write('observer rejected control\n');
    process.exitCode = 1;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
