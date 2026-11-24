'use strict';

const { Given, When, Then } = require('@cucumber/cucumber');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const prefix = 'cli-arity-refusals-name-command: ';
const repo = path.resolve(__dirname, '../..');
const target = process.env.CARGO_TARGET_DIR
  ? path.resolve(repo, process.env.CARGO_TARGET_DIR)
  : path.join(repo, 'target');
const binary = path.join(target, 'debug', 'kogen-context');
let built = false;

Given(prefix + 'the CLI is built and the example checkout exists', { timeout: 115000 }, function () {
  if (!built) {
    const result = spawnSync('cargo', ['build', '--locked', '--offline', '--bin', 'kogen-context'], {
      cwd: repo, encoding: 'utf8', timeout: 110000,
    });
    assert.equal(result.status, 0,
      `cargo build --locked --offline --bin kogen-context: ${result.error || ''}\n${result.stdout}${result.stderr}`);
    built = true;
  }
  assert.ok(fs.statSync(path.join(repo, 'contract/examples/checkout/util.py')).isFile());
});

When(prefix + 'I invoke the CLI with {string}', function (argumentsText) {
  this.arityArguments = argumentsText;
  this.arityResult = spawnSync(binary, argumentsText === '' ? [] : argumentsText.split(' '), {
    cwd: repo, encoding: 'utf8', timeout: 10000,
  });
  assert.equal(this.arityResult.error, undefined,
    `${binary} ${argumentsText}: ${this.arityResult.error}`);
});

function usageResult(world) {
  const result = world.arityResult;
  const context = `${binary} ${world.arityArguments}: status=${result.status}, stdout=${JSON.stringify(result.stdout)}, stderr=${JSON.stringify(result.stderr)}`;
  assert.equal(result.status, 2, context);
  assert.equal(result.stdout, '', context);
  const body = JSON.parse(result.stderr);
  assert.equal(body.error.code, 'usage', context);
  return { body, context };
}

Then(prefix + 'the usage refusal identifies {string} and expects {int} arguments', function (command, count) {
  const { body, context } = usageResult(this);
  const message = body.error.message;
  assert.equal(typeof message, 'string', context);
  assert.match(message, new RegExp(`\\b${command}\\b`), context);
  const number = count === 2 ? '(?:2|two)' : '(?:4|four)';
  // Accept common ways of stating an expected count, without fixing copy or labels.
  const expectation = new RegExp(
    `\\b(?:expects?|expected|requires?|required|takes?|accepts?)\\s+(?:exactly\\s+)?${number}\\b|` +
    `\\b${number}\\s+(?:positional\\s+)?(?:arguments?|args?)\\s+(?:expected|required)\\b`, 'i');
  assert.match(message, expectation, context);
});

Then(prefix + 'the usage refusal is', function (expected) {
  const { body, context } = usageResult(this);
  assert.deepEqual(body, JSON.parse(expected), context);
});

Then(prefix + 'the command succeeds with this output', function (expected) {
  const result = this.arityResult;
  const context = `${binary} ${this.arityArguments}: status=${result.status}, stdout=${JSON.stringify(result.stdout)}, stderr=${JSON.stringify(result.stderr)}`;
  assert.equal(result.status, 0, context);
  assert.equal(result.stderr, '', context);
  assert.equal(result.stdout, `${expected}\n`, context);
});
