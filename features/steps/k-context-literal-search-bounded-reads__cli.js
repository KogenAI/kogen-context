'use strict';

const { After, BeforeAll, Given, Then, When } = require('@cucumber/cucumber');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const P = 'k-context-literal-search-bounded-reads: ';
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
  if (this.parent) fs.rmSync(this.parent, { recursive: true, force: true });
});

function workspace(world) {
  if (!world.root) {
    world.parent = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kogen-context-')));
    world.root = path.join(world.parent, 'checkout');
    fs.mkdirSync(world.root);
  }
  return world.root;
}

function write(world, rel, content) {
  const file = path.join(workspace(world), rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

// Every entry under dir (symlinks are recorded, never followed), in sorted order.
function snapshot(dir) {
  const out = [];
  const walk = (abs, rel) => {
    for (const name of fs.readdirSync(abs).sort()) {
      const a = path.join(abs, name);
      const r = rel ? `${rel}/${name}` : name;
      const st = fs.lstatSync(a);
      if (st.isSymbolicLink()) out.push(`link ${r} -> ${fs.readlinkSync(a)}`);
      else if (st.isDirectory()) {
        out.push(`dir ${r}`);
        walk(a, r);
      } else {
        const hash = crypto.createHash('sha256').update(fs.readFileSync(a)).digest('hex');
        out.push(`file ${r} ${st.size} ${hash}`);
      }
    }
  };
  walk(dir, '');
  return out;
}

function run(world, args) {
  if (world.root && world.before === undefined) world.before = snapshot(world.root);
  const r = spawnSync(binary, args, {
    cwd: world.parent || repoRoot,
    encoding: 'utf8',
    timeout: 30000,
  });
  world.result = {
    args,
    status: r.status,
    signal: r.signal,
    error: r.error ? String(r.error) : undefined,
    stdout: r.stdout,
    stderr: r.stderr,
  };
  return world.result;
}

function describe(result) {
  return `command: ${JSON.stringify([binary, ...result.args])}\nexit status: ${result.status} (signal ${result.signal}, spawn error ${result.error})\nstdout: ${JSON.stringify(result.stdout)}\nstderr: ${JSON.stringify(result.stderr)}`;
}

function success(world) {
  const result = world.result;
  if (!result) fail('no kogen-context command has run');
  expectEqual(result.status, 0, `expected exit status 0\n${describe(result)}`);
  expectEqual(result.stderr, '', `expected empty stderr\n${describe(result)}`);
  let parsed;
  try {
    parsed = JSON.parse(result.stdout);
  } catch (e) {
    fail(`stdout is not one JSON document (${e.message})\n${describe(result)}`);
  }
  expectEqual(result.stdout, `${JSON.stringify(parsed)}\n`, `stdout is not one compact JSON line ending in a newline\n${describe(result)}`);
  return parsed;
}

function fail(message) {
  throw new Error(message);
}

function expectEqual(actual, expected, message) {
  if (actual !== expected) {
    fail(`${message}\nexpected: ${JSON.stringify(expected)}\nactual:   ${JSON.stringify(actual)}`);
  }
}

const sub = (world, s) => s.split('{root}').join(world.root);

Given(P + 'the Go fixture checkout', function () {
  write(this, 'main.go', [
    'package main',
    '',
    'import "example.com/demo/internal/greet"',
    '',
    'func main() {',
    '\tprintln(greet.Hello("world"))',
    '}',
    '',
  ].join('\n'));
  write(this, '.git/config', '[core]\n\tbare = false\n# Hello from git metadata\n');
  write(this, 'go.mod', 'module example.com/demo\n\ngo 1.27\n');
  write(this, 'internal/greet/greet.go', [
    'package greet',
    '',
    '// Hello returns a greeting for name.',
    'func Hello(name string) string {',
    '\treturn "Hello, " + name',
    '}',
    '',
  ].join('\n'));
});

Given(P + 'the non-Go fixture checkout', function () {
  write(this, 'app/util.py', 'def parse_config(path):\r\n    return open(path).read()\r\n');
  write(this, 'logo.bin', Buffer.concat([Buffer.from([0xff, 0xfe, 0x00]), Buffer.from('parse_config\n')]));
  write(this, 'app.py', 'from app.util import parse_config\n\nCONFIG = parse_config("app.toml")');
  write(this, 'README.md', '# Demo\n\nCafé: call parse_config to load settings.\n');
});

Given(P + 'the checkout links outside it as directory {string} and file {string}', function (dirLink, fileLink) {
  const root = workspace(this);
  const outside = path.join(this.parent, 'outside');
  fs.mkdirSync(outside, { recursive: true });
  fs.writeFileSync(path.join(outside, 'secret.txt'), 'Hello from outside\n');
  fs.symlinkSync('../outside', path.join(root, dirLink));
  fs.symlinkSync('../outside/secret.txt', path.join(root, fileLink));
});

Given(P + 'a checkout file {string} of {int} lines each containing {string}', function (rel, count, word) {
  let text = '';
  for (let i = 1; i <= count; i += 1) text += `line ${i} ${word}\n`;
  write(this, rel, text);
  this.word = word;
});

Given(P + 'a checkout file {string} holding one line of {int} {string} characters', function (rel, count, ch) {
  write(this, rel, `${ch.repeat(count)}\n`);
});

When(P + 'I search for {string}', function (literal) {
  run(this, ['search', this.root, literal]);
});

When(P + 'I read {string} lines {string} to {string}', function (rel, start, end) {
  run(this, ['read', this.root, rel, start, end]);
});

When(P + 'I run kogen-context with arguments {string}', function (json) {
  const args = JSON.parse(json);
  if (!Array.isArray(args)) fail(`arguments must be a JSON array: ${json}`);
  run(this, args.map((a) => sub(this, a)));
});

Then(P + 'the command succeeds with JSON:', function (expected) {
  const parsed = success(this);
  expectEqual(
    JSON.stringify(parsed),
    JSON.stringify(JSON.parse(expected)),
    `JSON output differs from the expected document\n${describe(this.result)}`,
  );
});

Then(P + 'the command fails with exit code {int}, error code {string} and message {string}', function (exit, code, message) {
  const result = this.result;
  if (!result) fail('no kogen-context command has run');
  const expected = `${JSON.stringify({ error: { code, message: sub(this, message) } })}\n`;
  expectEqual(result.status, exit, `expected exit status ${exit}\n${describe(result)}`);
  expectEqual(result.stdout, '', `expected empty stdout\n${describe(result)}`);
  expectEqual(result.stderr, expected, `expected stderr ${JSON.stringify(expected)}\n${describe(result)}`);
});

Then(P + 'running the same command again prints identical bytes', function () {
  const first = this.result;
  if (!first) fail('no kogen-context command has run');
  const second = run(this, first.args);
  expectEqual(second.status, first.status, `exit status changed between runs\nfirst:\n${describe(first)}\nsecond:\n${describe(second)}`);
  expectEqual(second.stdout, first.stdout, `stdout changed between runs\nfirst:\n${describe(first)}\nsecond:\n${describe(second)}`);
  expectEqual(second.stderr, first.stderr, `stderr changed between runs\nfirst:\n${describe(first)}\nsecond:\n${describe(second)}`);
});

Then(P + 'the checkout contents are unchanged', function () {
  if (!this.before) fail('no kogen-context command has run against the checkout');
  expectEqual(
    snapshot(this.root).join('\n'),
    this.before.join('\n'),
    'the checkout changed while kogen-context ran',
  );
});

Then(P + 'the search output has {int} matches in {string} from line {int} to line {int}, truncated {string}', function (count, rel, first, last, truncated) {
  const parsed = success(this);
  if (!Array.isArray(parsed.matches)) fail(`search output has no matches array\n${describe(this.result)}`);
  expectEqual(parsed.matches.length, count, `expected ${count} matches\n${describe(this.result)}`);
  parsed.matches.forEach((m, i) => {
    const line = first + i;
    expectEqual(
      JSON.stringify(m),
      JSON.stringify({ path: rel, line, column: String(line).length + 7, text: `line ${line} ${this.word}` }),
      `unexpected match ${i + 1}\n${describe(this.result)}`,
    );
  });
  expectEqual(first + count - 1, last, `the scenario's last line ${last} does not follow from ${count} matches from line ${first}`);
  expectEqual(parsed.truncated, truncated === 'true', `expected truncated ${truncated}\n${describe(this.result)}`);
});

Then(P + 'the read output has lines {int} to {int} of {int} in {string}', function (start, end, total, rel) {
  const parsed = success(this);
  const lines = [];
  for (let n = start; n <= end; n += 1) lines.push({ line: n, text: `line ${n} ${this.word}` });
  expectEqual(
    JSON.stringify(parsed),
    JSON.stringify({ path: rel, start, end, total_lines: total, lines }),
    `unexpected read output\n${describe(this.result)}`,
  );
});

Then(P + 'the read output line {int} of {string} is {int} {string} characters', function (line, rel, count, ch) {
  const parsed = success(this);
  expectEqual(
    JSON.stringify(parsed),
    JSON.stringify({ path: rel, start: line, end: line, total_lines: 1, lines: [{ line, text: ch.repeat(count) }] }),
    `unexpected read output\n${describe(this.result)}`,
  );
});

Then(P + 'the only search match is in {string} at line {int} column {int} with {int} {string} characters', function (rel, line, column, count, ch) {
  const parsed = success(this);
  expectEqual(
    JSON.stringify(parsed.matches),
    JSON.stringify([{ path: rel, line, column, text: ch.repeat(count) }]),
    `unexpected search matches\n${describe(this.result)}`,
  );
  expectEqual(parsed.truncated, false, `expected truncated false\n${describe(this.result)}`);
});
