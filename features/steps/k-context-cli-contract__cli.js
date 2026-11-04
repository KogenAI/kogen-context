'use strict';

const { After, BeforeAll, Given, Then, When } = require('@cucumber/cucumber');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { sameJson, validate } = require('./k-context-cli-contract__schema.js');

const P = 'k-context-cli-contract: ';
const repoRoot = path.resolve(__dirname, '..', '..');
const targetDir = process.env.CARGO_TARGET_DIR
  ? path.resolve(repoRoot, process.env.CARGO_TARGET_DIR)
  : path.join(repoRoot, 'target');
const binary = path.join(targetDir, 'debug', 'kogen-context');
const buildCommand = ['cargo', 'build', '--locked', '--offline', '--bin', 'kogen-context'];
const packetSchema = 'contract/packet.schema.json';

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

function fail(message) {
  throw new Error(message);
}

function expectEqual(actual, expected, message) {
  if (actual !== expected) {
    fail(`${message}\nexpected: ${JSON.stringify(expected)}\nactual:   ${JSON.stringify(actual)}`);
  }
}

function workspace(world) {
  if (!world.root) {
    world.parent = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kogen-context-contract-')));
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

const sub = (world, s) => s.split('{root}').join(workspace(world));

function repoFile(rel) {
  const file = path.join(repoRoot, rel);
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) fail(`${rel} is not a regular file in the repository`);
  return fs.readFileSync(file, 'utf8');
}

function repoJson(rel) {
  const text = repoFile(rel);
  try {
    return JSON.parse(text);
  } catch (e) {
    return fail(`${rel} is not JSON (${e.message})`);
  }
}

function run(world, args, input, cwd) {
  const r = spawnSync(binary, args, { cwd, input, encoding: 'utf8', timeout: 30000 });
  world.result = {
    args,
    input,
    cwd,
    status: r.status,
    signal: r.signal,
    error: r.error ? String(r.error) : undefined,
    stdout: r.stdout,
    stderr: r.stderr,
  };
  return world.result;
}

function describe(result) {
  return [
    `command: ${JSON.stringify([binary, ...result.args])} in ${result.cwd}`,
    `stdin: ${JSON.stringify(result.input)}`,
    `exit status: ${result.status} (signal ${result.signal}, spawn error ${result.error})`,
    `stdout: ${JSON.stringify(result.stdout)}`,
    `stderr: ${JSON.stringify(result.stderr)}`,
  ].join('\n');
}

function lastResult(world) {
  if (!world.result) fail('no kogen-context command has run');
  return world.result;
}

// Exit status, empty stderr and stdout exactly the compact form of expected plus a newline.
function expectPacket(world, status, expected) {
  const result = lastResult(world);
  expectEqual(result.status, status, `expected exit status ${status}\n${describe(result)}`);
  expectEqual(result.stderr, '', `expected empty stderr\n${describe(result)}`);
  expectEqual(result.stdout, `${JSON.stringify(expected)}\n`, `unexpected packet on stdout\n${describe(result)}`);
  expectValid(packetSchema, JSON.parse(result.stdout), `the packet on stdout\n${describe(result)}`);
}

function expectValid(schemaPath, value, what) {
  const errors = validate(repoJson(schemaPath), value);
  if (errors.length) fail(`${what}\ndoes not validate against ${schemaPath}:\n${errors.join('\n')}`);
}

function listFiles(dir, rel = '') {
  const out = [];
  for (const name of fs.readdirSync(path.join(dir, rel)).sort()) {
    const r = rel ? `${rel}/${name}` : name;
    const st = fs.lstatSync(path.join(dir, r));
    if (st.isDirectory()) out.push(...listFiles(dir, r));
    else out.push(st.isFile() ? r : `${r} (not a regular file)`);
  }
  return out;
}

const numberedLines = (word, start, end) => {
  const lines = [];
  for (let n = start; n <= end; n += 1) lines.push(`line ${n} ${word}`);
  return lines;
};

Given(P + 'a checkout file {string} with the content:', function (rel, content) {
  write(this, rel, `${content}\n`);
});

Given(P + 'a checkout file {string} of {int} lines each containing {string}', function (rel, count, word) {
  write(this, rel, numberedLines(word, 1, count).map((l) => `${l}\n`).join(''));
  this.word = word;
});

Given(P + 'a checkout file {string} holding one line of {int} {string} characters', function (rel, count, ch) {
  write(this, rel, `${ch.repeat(count)}\n`);
});

When(P + 'I send the request:', function (request) {
  workspace(this);
  run(this, ['request'], sub(this, request), this.parent);
});

When(P + 'I send the request bytes {string}', function (request) {
  workspace(this);
  run(this, ['request'], request, this.parent);
});

When(P + 'I send the file {string} to kogen-context request from the repository root', function (rel) {
  run(this, ['request'], repoFile(rel), repoRoot);
});

When(P + 'I run kogen-context with arguments {string}', function (json) {
  const args = JSON.parse(json);
  if (!Array.isArray(args)) fail(`arguments must be a JSON array: ${json}`);
  workspace(this);
  run(this, args.map((a) => sub(this, a)), '', this.parent);
});

Then(P + 'the file {string} holds JSON:', function (rel, expected) {
  const actual = repoJson(rel);
  if (!sameJson(actual, JSON.parse(expected))) {
    fail(`${rel} differs from the expected JSON\nexpected: ${JSON.stringify(JSON.parse(expected))}\nactual:   ${JSON.stringify(actual)}`);
  }
});

Then(P + 'the file {string} holds exactly the JSON line:', function (rel, expected) {
  expectEqual(JSON.stringify(JSON.parse(expected)), expected, 'the scenario\'s expected JSON line is not compact');
  expectEqual(repoFile(rel), `${expected}\n`, `${rel} is not exactly the expected JSON line`);
});

Then(P + 'the file {string} has the content:', function (rel, expected) {
  expectEqual(repoFile(rel), `${expected}\n`, `${rel} does not have the expected content`);
});

Then(P + 'the file {string} mentions {string}', function (rel, text) {
  if (!repoFile(rel).includes(text)) fail(`${rel} does not mention ${JSON.stringify(text)}`);
});

Then(P + 'the directory {string} holds exactly these files:', function (rel, expected) {
  const dir = path.join(repoRoot, rel);
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) fail(`${rel} is not a directory in the repository`);
  expectEqual(listFiles(dir).join('\n'), expected, `${rel} does not hold exactly the expected files`);
});

Then(P + 'the file {string} validates against {string}', function (rel, schemaPath) {
  expectValid(schemaPath, repoJson(rel), rel);
});

Then(P + 'the command exits with status {int}, prints nothing on stderr and prints exactly the file {string}', function (status, rel) {
  const result = lastResult(this);
  expectEqual(result.status, status, `expected exit status ${status}\n${describe(result)}`);
  expectEqual(result.stderr, '', `expected empty stderr\n${describe(result)}`);
  expectEqual(result.stdout, repoFile(rel), `stdout is not exactly ${rel}\n${describe(result)}`);
});

Then(P + 'the printed packet validates against {string}', function (schemaPath) {
  const result = lastResult(this);
  let packet;
  try {
    packet = JSON.parse(result.stdout);
  } catch (e) {
    fail(`stdout is not JSON (${e.message})\n${describe(result)}`);
  }
  expectValid(schemaPath, packet, `the packet on stdout\n${describe(result)}`);
});

Then(P + 'the request succeeds with the packet:', function (expected) {
  expectPacket(this, 0, JSON.parse(expected));
});

Then(P + 'the request is refused with exit status {int}, code {string} and message {string}', function (status, code, message) {
  expectPacket(this, status, { version: 1, error: { code, message: sub(this, message) } });
});

Then(
  P + 'the request succeeds with {int} matches in {string} from line 1, truncated {string}, max matches {int} and max line chars {int}',
  function (count, rel, truncated, maxMatches, maxLineChars) {
    const matches = numberedLines(this.word, 1, count).map((text, i) => ({
      path: rel,
      line: i + 1,
      column: String(i + 1).length + 7,
      text,
    }));
    expectPacket(this, 0, {
      version: 1,
      operation: 'search',
      query: this.word,
      matches,
      truncated: truncated === 'true',
      limits: { max_matches: maxMatches, max_line_chars: maxLineChars },
    });
  },
);

Then(
  P + 'the request succeeds with lines {int} to {int} of {int} in {string}, max lines {int} and max line chars {int}',
  function (start, end, total, rel, maxLines, maxLineChars) {
    const lines = numberedLines(this.word, start, end).map((text, i) => ({ line: start + i, text }));
    expectPacket(this, 0, {
      version: 1,
      operation: 'read',
      path: rel,
      start,
      end,
      total_lines: total,
      lines,
      limits: { max_lines: maxLines, max_line_chars: maxLineChars },
    });
  },
);

Then(
  P + 'the request succeeds with line 1 of {string} as {int} {string} characters, max line chars {int}',
  function (rel, count, ch, maxLineChars) {
    expectPacket(this, 0, {
      version: 1,
      operation: 'read',
      path: rel,
      start: 1,
      end: 1,
      total_lines: 1,
      lines: [{ line: 1, text: ch.repeat(count) }],
      limits: { max_lines: 200, max_line_chars: maxLineChars },
    });
  },
);

Then(P + 'the command succeeds with the unversioned output:', function (expected) {
  const result = lastResult(this);
  expectEqual(result.status, 0, `expected exit status 0\n${describe(result)}`);
  expectEqual(result.stderr, '', `expected empty stderr\n${describe(result)}`);
  expectEqual(result.stdout, `${JSON.stringify(JSON.parse(expected))}\n`, `unexpected output\n${describe(result)}`);
});

Then(P + 'the command fails on stderr with exit status {int}, code {string} and message {string}', function (status, code, message) {
  const result = lastResult(this);
  expectEqual(result.status, status, `expected exit status ${status}\n${describe(result)}`);
  expectEqual(result.stdout, '', `expected empty stdout\n${describe(result)}`);
  expectEqual(result.stderr, `${JSON.stringify({ error: { code, message } })}\n`, `unexpected stderr\n${describe(result)}`);
});
