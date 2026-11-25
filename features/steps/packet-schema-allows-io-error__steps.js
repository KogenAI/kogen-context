'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const P = 'packet-schema-allows-io-error: ';
const repo = path.resolve(__dirname, '..', '..');
const target = path.resolve(repo, process.env.CARGO_TARGET_DIR || 'target');
const packetSchema = 'contract/packet.schema.json';

function run(command, args, input, timeout = 10000) {
  const result = spawnSync(command, args, { input, timeout, cwd: repo, encoding: 'utf8' });
  if (result.error) throw result.error;
  if (result.signal) throw new Error(`${command} terminated by ${result.signal}`);
  return result;
}

function request(input) {
  const build = run('cargo', ['build', '--locked', '--offline', '--bin', 'kogen-context'], undefined, 90000);
  if (build.status !== 0) throw new Error(`cargo build failed:\n${build.stdout}${build.stderr}`);
  return run(path.join(target, 'debug', 'kogen-context'), ['request'], input);
}

function refusal(result, status, code, prefix) {
  assert.equal(result.status, status, `unexpected request status (stdout: ${result.stdout}, stderr: ${result.stderr})`);
  assert.equal(result.stderr, '', 'request stderr must be empty');
  const packet = JSON.parse(result.stdout);
  assert.equal(packet?.error?.code, code, `wrong refusal code in: ${result.stdout}`);
  assert.ok(typeof packet.error.message === 'string' && packet.error.message.startsWith(prefix),
    `wrong refusal message in: ${result.stdout}`);
  return packet;
}

const validate = `
import json, sys
from jsonschema import Draft202012Validator
with open(sys.argv[1], encoding='utf-8') as source:
    schema = json.load(source)
Draft202012Validator.check_schema(schema)
validator = Draft202012Validator(schema)
print(json.dumps(['valid' if validator.is_valid(p) else 'invalid' for p in json.load(sys.stdin)]))
`;

function expectPackets(packets, schema, expected) {
  const result = run('python3', ['-c', validate, schema], JSON.stringify(packets));
  if (result.status !== 0) throw new Error(`cannot validate against ${schema}:\n${result.stdout}${result.stderr}`);
  const outcomes = JSON.parse(result.stdout);
  assert.equal(outcomes.length, packets.length, `validator did not check every packet against ${schema}`);
  for (const [i, packet] of packets.entries()) {
    assert.ok(outcomes[i] === expected,
      `packet with code ${packet.error.code}: expected ${expected} against ${schema}, got ${outcomes[i]}`);
  }
}

function errorPacket(code, message) {
  return { version: 1, error: { code, message } };
}

if (require.main === module) {
  // Qualify the same observers on the unchanged tree with independently known
  // accepted and rejected packets. The procfs refusal itself already exists.
  try {
    refusal(request('{"version":1,"root":"/proc/self","operation":"read","path":"mem","start":1,"end":1}'),
      1, 'io_error', 'cannot read file: mem: ');
    expectPackets([errorPacket(process.argv[2], 'x')], packetSchema, 'valid');
    console.log('observer validated the packet');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
} else {
  const { Given, When, Then } = require('@cucumber/cucumber');

  When(P + 'kogen-context request receives this JSON:', { timeout: 110000 }, function (input) {
    this.readResult = request(input);
  });

  Then(P + 'the refusal has status {int}, empty stderr, code {string}, and a message starting with {string}', function (status, code, prefix) {
    this.packets = [refusal(this.readResult, status, code, prefix)];
  });

  Given(P + 'these version 1 error packets with message {string}:', function (message, table) {
    this.packets = table.hashes().map(({ code }) => errorPacket(code, message));
  });

  for (const subject of ['the packet is', 'the packets are']) {
    Then(P + subject + ' {string} against {string}', { timeout: 12000 }, function (expected, schema) {
      expectPackets(this.packets, schema, expected);
    });
  }
}
