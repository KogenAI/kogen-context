'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { TextDecoder } = require('node:util');

const prefix = 'request-input-size-limit: ';
const root = path.resolve(__dirname, '..', '..');
const target = path.resolve(root, process.env.CARGO_TARGET_DIR || 'target');
const cli = path.join(target, 'debug', 'kogen-context');
let built = false;

function run(input, bytes) {
  if (bytes !== undefined) {
    const padded = Buffer.alloc(bytes, 0x20);
    const written = Buffer.from(input, 'utf8').copy(padded);
    assert.equal(written, Buffer.byteLength(input), 'the padding must not truncate the JSON');
    input = padded;
  }
  const label = `kogen-context request (${Buffer.byteLength(input)} stdin bytes)`;
  // A file on stdin delivers the same byte stream without making an early
  // refusal race with a pipe writer (which might get EPIPE).
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'request-size-'));
  try {
    const filename = path.join(dir, 'stdin');
    fs.writeFileSync(filename, input);
    const fd = fs.openSync(filename, 'r');
    try {
      const r = spawnSync(cli, ['request'], {
        cwd: root, stdio: [fd, 'pipe', 'pipe'], timeout: 10000,
        maxBuffer: 8 * 1024 * 1024,
        env: { ...process.env, HOME: '', XDG_CACHE_HOME: '' },
      });
      assert.ifError(r.error);
      assert.equal(r.signal, null, label);
      return { label, status: r.status, stdout: r.stdout, stderr: r.stderr };
    } finally {
      fs.closeSync(fd);
    }
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
}

function readPacket(result) {
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(result.stdout));
  } catch (cause) {
    throw new Error(`${result.label}: stdout must be one valid JSON packet`, { cause });
  }
}

function assertPacket(result, status, expected) {
  assert.equal(result.status, status, `${result.label}: exit status`);
  assert.deepEqual(readPacket(result), expected, `${result.label}: packet`);
  assert.equal(result.stderr.length, 0, `${result.label}: stderr`);
  const stdout = result.stdout.toString('utf8');
  assert.equal(stdout.indexOf('\n'), stdout.length - 1, `${result.label}: stdout line count`);
  assert.ok(stdout.endsWith('\n'), `${result.label}: stdout final newline`);
}

function assertLargePacket(result, limit, expected) {
  assertPacket(result, 0, expected);
  assert.ok(result.stdout.length > limit, `${result.label}: stdout must exceed ${limit} bytes`);
}

function assertOversized(result, code, marker) {
  assert.equal(result.status, 2, `${result.label}: exit status`);
  const packet = readPacket(result);
  assert.equal(packet?.error?.code, code, `${result.label}: refusal code`);
  assert.ok(![result.stdout.toString('utf8'), result.stderr.toString('utf8'), JSON.stringify(packet)]
    .some(text => text.includes(marker)), `${result.label}: echoed input marker`);
}

if (require.main !== module) {
  const { Given, When, Then } = require('@cucumber/cucumber');

  Given(prefix + 'the kogen-context CLI is built', { timeout: 100000 }, function () {
    if (built) return;
    const build = spawnSync('cargo', ['build', '--locked', '--offline', '--bin', 'kogen-context'], {
      cwd: root, encoding: 'utf8', timeout: 90000,
    });
    assert.ifError(build.error);
    assert.equal(build.status, 0, `cargo build failed:\n${build.stdout}${build.stderr}`);
    built = true;
  });

  When(prefix + 'kogen-context request runs this JSON unpadded and padded to {int} and {int} bytes',
    { timeout: 40000 }, function (below, at, json) {
      this.search = json;
      this.results = [run(json), run(json, below), run(json, at)];
    });

  When(prefix + 'kogen-context request runs this input', { timeout: 15000 }, function (input) {
    this.results = [run(input)];
  });

  Then(prefix + 'each run exits with status {int} and returns this packet', function (status, json) {
    const expected = JSON.parse(json);
    for (const result of this.results) assertPacket(result, status, expected);
    if (status === 0) this.searchPacket = expected;
  });

  When(prefix + 'kogen-context request runs the original search with its literal extended to fill {int} input bytes',
    { timeout: 15000 }, function (limit) {
      const search = JSON.parse(this.search);
      search.literal += 'z'.repeat(limit - Buffer.byteLength(JSON.stringify(search)));
      const input = JSON.stringify(search);
      assert.equal(Buffer.byteLength(input), limit, 'long-literal fixture size');
      this.longQuery = search.literal;
      this.longResult = run(input);
    });

  Then(prefix + 'it exits with status 0 and returns the complete search packet with that literal, larger than {int} bytes',
    function (limit) {
      assertLargePacket(this.longResult, limit, { ...this.searchPacket, query: this.longQuery });
    });

  When(prefix + 'kogen-context request runs the original search JSON padded to {int} and {int} bytes',
    { timeout: 30000 }, function (above, larger) {
      this.results = [run(this.search, above), run(this.search, larger)];
    });

  Then(prefix + 'each run exits with status 2 and returns one JSON refusal with code {string} without echoing {string}',
    function (code, marker) {
      for (const result of this.results) assertOversized(result, code, marker);
    });
} else {
  // Focused observer controls; normal Cucumber execution always runs the CLI.
  const status = 2;
  const code = 'invalid_request';
  const marker = 'request-size-sentinel-é-9f21';
  const label = 'observer control';
  const result = (stdout, overrides = {}) => ({
    status, label, stdout: Buffer.from(stdout), stderr: Buffer.alloc(0), ...overrides,
  });
  const refusal = '{"version":1,"error":{"code":"invalid_request","message":"size limit exceeded"}}\n';
  if (process.argv[2] === 'good') {
    assertOversized(result(refusal), code, marker);
    assertPacket(result(refusal), status, JSON.parse(refusal));
    assertLargePacket(result(refusal, { status: 0 }), Buffer.byteLength(refusal) - 1, JSON.parse(refusal));
    console.log('observer accepted valid packets');
  } else if (process.argv[2] === 'bad') {
    assert.throws(() => assertOversized(result(refusal, { status: 0 }), code, marker), /exit status/);
    assert.throws(() => assertOversized(result(''), code, marker), /one valid JSON packet/);
    assert.throws(() => assertOversized(result(refusal + refusal), code, marker), /one valid JSON packet/);
    assert.throws(() => assertOversized(result(refusal.replace(code, 'unsupported_version')), code, marker), /refusal code/);
    const escaped = refusal.replace('size limit exceeded', 'request-size-sentinel-\\u00e9-9f21');
    assert.throws(() => assertOversized(result(escaped), code, marker), /echoed input marker/);
    assert.throws(() => assertOversized(result(refusal, { stderr: Buffer.from(marker) }), code, marker), /echoed input marker/);
    assert.throws(() => assertPacket(result(refusal), status, { version: 2 }), /packet/);
    assert.throws(() => assertLargePacket(result(refusal, { status: 0 }), Buffer.byteLength(refusal), JSON.parse(refusal)), /stdout must exceed/);
    console.log('observer rejected invalid packets');
    process.exitCode = 1;
  } else {
    throw new Error('expected a good or bad observer control');
  }
}
