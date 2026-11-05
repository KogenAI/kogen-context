'use strict';

// Runs one command under strace and reports what it did beyond reading files
// inside one checkout root: network calls, other programs, writes or file
// system changes, and opens outside the root. Used by the steps and runnable
// alone:
//   node features/steps/k-context-ranked-scoped-results__trace.js ROOT INPUT_FILE -- COMMAND [ARG...]
// runs COMMAND from the current directory with INPUT_FILE on stdin, prints
// "ok" or one problem per line, and exits 0 (ok), 1 (problems) or 2 (usage).

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const NETWORK = new Set([
  'socket', 'socketpair', 'connect', 'bind', 'listen', 'accept', 'accept4', 'sendto', 'sendmsg',
  'sendmmsg', 'recvfrom', 'recvmsg', 'recvmmsg', 'shutdown', 'getsockopt', 'setsockopt',
  'getsockname', 'getpeername',
]);
const CHANGES = new Set([
  'unlink', 'unlinkat', 'rename', 'renameat', 'renameat2', 'mkdir', 'mkdirat', 'rmdir', 'truncate',
  'ftruncate', 'chmod', 'fchmod', 'fchmodat', 'fchmodat2', 'chown', 'fchown', 'fchownat', 'lchown',
  'link', 'linkat', 'symlink', 'symlinkat', 'utime', 'utimes', 'utimensat', 'futimesat', 'setxattr',
  'lsetxattr', 'fsetxattr', 'removexattr', 'lremovexattr', 'fremovexattr', 'mknod', 'mknodat',
]);
const OPENS = new Set(['open', 'openat', 'openat2', 'creat']);
const WRITE_FLAGS = ['O_WRONLY', 'O_RDWR', 'O_CREAT', 'O_TRUNC', 'O_APPEND'];
// What the dynamic loader and the Rust runtime may read outside the root.
const SYSTEM = ['/etc/ld.so.cache', '/lib/', '/lib64/', '/usr/lib/', '/usr/lib64/', '/proc/self/', '/sys/fs/cgroup/', '/sys/devices/system/cpu/'];
const TRACED = '%file,%network,%process,ftruncate,fchmod,fchown,fsetxattr,fremovexattr';

function unquote(s) {
  return s.replace(/\\(x[0-9a-fA-F]{2}|[0-7]{1,3}|.)/g, (_, e) => {
    if (e[0] === 'x') return String.fromCharCode(parseInt(e.slice(1), 16));
    if (/^[0-7]+$/.test(e)) return String.fromCharCode(parseInt(e, 8));
    return { n: '\n', t: '\t', r: '\r', v: '\v', f: '\f' }[e] || e;
  });
}

function inside(file, dir) {
  const rel = path.relative(dir, file);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function shown(file, cwd) {
  return inside(file, cwd) ? path.relative(cwd, file) || '.' : file;
}

function resolved(file) {
  try {
    return fs.realpathSync(file);
  } catch {
    return path.resolve(file);
  }
}

// The problems in strace -f -y output for a run rooted at root from cwd.
function problems(traceText, root, cwd) {
  const realRoot = fs.realpathSync(root);
  const realCwd = fs.realpathSync(cwd);
  const out = new Set();
  let execs = 0;
  for (const raw of traceText.split('\n')) {
    const m = /^\d+\s+([a-z_0-9]+)\((.*)$/.exec(raw);
    if (!m) continue;
    const [, name, rest] = m;
    if (NETWORK.has(name)) out.add(`network call: ${name}`);
    else if (name === 'execve' || name === 'execveat') {
      execs += 1;
      const target = /"((?:[^"\\]|\\.)*)"/.exec(rest);
      if (execs > 1) out.add(`ran another program: ${target ? unquote(target[1]) : name}`);
    } else if (CHANGES.has(name)) out.add(`changed the file system: ${name}`);
    else if (OPENS.has(name)) {
      const am = /^(?:(AT_FDCWD|-?\d+)(?:<((?:[^>\\]|\\.)*)>)?,\s*)?"((?:[^"\\]|\\.)*)"(.*)$/.exec(name === 'openat' || name === 'openat2' ? rest : `AT_FDCWD, ${rest}`);
      if (!am) {
        out.add(`unreadable ${name} call: ${raw}`);
        continue;
      }
      const [, dirfd, dirPath, quoted, tail] = am;
      const file = unquote(quoted);
      const base = dirfd === 'AT_FDCWD' || path.isAbsolute(file) ? realCwd : unquote(dirPath || '');
      const abs = path.resolve(base, file);
      const flags = name === 'creat' ? 'O_CREAT|O_WRONLY|O_TRUNC' : tail;
      if (WRITE_FLAGS.some((f) => new RegExp(`\\b${f}\\b`).test(flags))) {
        out.add(`opened for writing: ${shown(abs, realCwd)}`);
        continue;
      }
      const real = resolved(abs);
      if (inside(abs, realRoot) && inside(real, realRoot)) continue;
      if (SYSTEM.some((p) => abs.startsWith(p) || real.startsWith(p))) continue;
      const where = real === abs ? shown(abs, realCwd) : `${shown(abs, realCwd)} -> ${shown(real, realCwd)}`;
      out.add(`opened outside the root: ${where}`);
    }
  }
  return [...out].sort();
}

// Runs command with args from cwd under strace, input on stdin.
function traced(root, input, command, args, cwd) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kogen-context-trace-'));
  const log = path.join(dir, 'trace.txt');
  try {
    const r = spawnSync('strace', ['-f', '-qq', '-y', '-o', log, '-e', `trace=${TRACED}`, command, ...args], {
      cwd,
      input,
      timeout: 120000,
      maxBuffer: 64 * 1024 * 1024,
    });
    if (r.error) throw new Error(`strace could not run ${command}: ${r.error.message}`);
    const text = fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : '';
    if (!text) throw new Error(`strace wrote no trace for ${command} (status ${r.status}): ${String(r.stderr)}`);
    return { status: r.status, stdout: r.stdout, stderr: r.stderr, problems: problems(text, root, cwd) };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

module.exports = { problems, traced };

if (require.main === module) {
  const argv = process.argv.slice(2);
  const sep = argv.indexOf('--');
  if (argv.length < 4 || sep !== 2) {
    process.stderr.write('usage: node k-context-ranked-scoped-results__trace.js ROOT INPUT_FILE -- COMMAND [ARG...]\n');
    process.exit(2);
  }
  const [root, inputFile] = argv;
  const result = traced(root, fs.readFileSync(inputFile), argv[3], argv.slice(4), process.cwd());
  process.stdout.write(result.problems.length ? result.problems.map((p) => `${p}\n`).join('') : 'ok\n');
  process.exit(result.problems.length ? 1 : 0);
}
