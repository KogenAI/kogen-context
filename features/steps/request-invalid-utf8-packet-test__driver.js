'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '../..');
const anchor = '    let (packet, status) = respond(if read_ok { &input } else { b"" });';
const mutations = {
  'exit status': 'return ExitCode::from(0);',
  'JSON formatting': 'let _ = write_line("not JSON"); return ExitCode::from(2);',
  'packet count': 'let (packet, _) = respond(&input); let _ = write_line(&packet); let _ = write_line(&packet); return ExitCode::from(2);',
  'stderr': 'eprintln!("invalid input");',
  'error code': 'let _ = write_line("{\\"version\\":1,\\"error\\":{\\"code\\":\\"unsupported_version\\",\\"message\\":\\"request is not one valid JSON object\\"}}"); return ExitCode::from(2);',
  'error message': 'let _ = write_line("{\\"version\\":1,\\"error\\":{\\"code\\":\\"invalid_request\\",\\"message\\":\\"wrong message\\"}}"); return ExitCode::from(2);',
  'input echo': 'let (packet, _) = respond(&input); let packet = format!("{},\\"input\\":{}}}", &packet[..packet.len()-1], json_string(&String::from_utf8_lossy(&input))); let _ = write_line(&packet); return ExitCode::from(2);',
};

function copy() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'invalid-utf8-packet-'));
  for (const f of ['Cargo.toml', 'Cargo.lock', 'rust-toolchain.toml', 'src', 'contract']) {
    fs.cpSync(path.join(root, f), path.join(dir, f), { recursive: true });
  }
  fs.mkdirSync(path.join(dir, 'tests'));
  fs.copyFileSync(path.join(root, 'tests/contract.rs'), path.join(dir, 'tests/contract.rs'));
  return dir;
}

function run(dir, mutation) {
  const file = path.join(dir, 'src/request.rs');
  const original = fs.readFileSync(file, 'utf8');
  if (mutation !== 'unchanged') {
    assert.ok(Object.hasOwn(mutations, mutation), `unknown mutation: ${mutation}`);
    assert.equal(original.split(anchor).length, 2, 'non-UTF-8 transport mutation must find its anchor exactly once');
    fs.writeFileSync(file, original.replace(anchor,
      '    if std::str::from_utf8(&input).is_err() { ' + mutations[mutation] + ' }\n' + anchor));
  }
  try {
    const args = ['test', '--locked', '--offline', '--test', 'contract', '--', '--nocapture'];
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
      assert.notEqual(r.status, 0, `contract tests did not reject ${mutation}: ${detail}`);
      assert.match(r.stdout, /test result: FAILED\./, `contract tests did not report an assertion failure for ${mutation}: ${detail}`);
      assert.match(r.stdout, /[1-9][0-9]* failed;/, detail);
    }
  } finally {
    fs.writeFileSync(file, original);
  }
}

module.exports = { copy, run };

// Final-byte observer qualification: use bounded known-good / known-bad
// integration-test fixtures, not invented test-runner output.
if (require.main === module) {
  const fixture = process.argv[2];
  const dir = copy();
  try {
    fs.copyFileSync(path.resolve(root, fixture), path.join(dir, 'tests/contract.rs'));
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
