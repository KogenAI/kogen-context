'use strict';

// Checks one release artifact directory: exactly the binary and SHA256SUMS,
// the binary executable, SHA256SUMS naming the binary's SHA-256 and the
// release script's stdout equal to SHA256SUMS. Usable as a module and as
// `node k-context-release-binaries__check.js artifacts DIR TAG PLATFORM STDOUT_FILE`.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

function artifactName(tag, platform) {
  return `kogen-context-${tag}-${platform}`;
}

function checkArtifacts(dir, tag, platform, stdout) {
  const name = artifactName(tag, platform);
  let entries;
  try {
    entries = fs.readdirSync(dir).sort();
  } catch (e) {
    return [`cannot list the artifact directory: ${e.code}`];
  }
  const problems = [];
  const expected = ['SHA256SUMS', name].sort();
  if (JSON.stringify(entries) !== JSON.stringify(expected)) {
    problems.push(`entries: expected ${JSON.stringify(expected)}, actual ${JSON.stringify(entries)}`);
  }
  const st = fs.lstatSync(path.join(dir, name), { throwIfNoEntry: false });
  if (!st || !st.isFile()) {
    problems.push(`${name} is not a regular file`);
    return problems;
  }
  if ((st.mode & 0o100) === 0) problems.push(`${name} is not executable by its owner`);
  const sum = crypto.createHash('sha256').update(fs.readFileSync(path.join(dir, name))).digest('hex');
  const line = `${sum}  ${name}\n`;
  const sumsFile = path.join(dir, 'SHA256SUMS');
  const sums = fs.existsSync(sumsFile) ? fs.readFileSync(sumsFile, 'utf8') : null;
  if (sums !== line) problems.push(`SHA256SUMS: expected ${JSON.stringify(line)}, actual ${JSON.stringify(sums)}`);
  if (stdout !== line) problems.push(`stdout: expected ${JSON.stringify(line)}, actual ${JSON.stringify(stdout)}`);
  return problems;
}

module.exports = { artifactName, checkArtifacts };

if (require.main === module) {
  const [mode, dir, tag, platform, stdoutFile] = process.argv.slice(2);
  if (mode !== 'artifacts' || process.argv.length !== 7) {
    process.stderr.write('usage: artifacts DIR TAG PLATFORM STDOUT_FILE\n');
    process.exit(2);
  }
  const problems = checkArtifacts(dir, tag, platform, fs.readFileSync(stdoutFile, 'utf8'));
  process.stdout.write(problems.length ? `${problems.join('\n')}\n` : 'ok\n');
  process.exit(problems.length ? 1 : 0);
}
