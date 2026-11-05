'use strict';

// Records every entry under a directory, symlinks recorded and never
// followed, with its kind, size, content hash, permissions, inode and
// modification and change times, and lists the entries that differ between
// two records. Reading a file changes none of these. Used by the steps and
// runnable alone:
//   node features/steps/k-context-commit-index-overlay__tree.js DIR -- COMMAND [ARG...]
// records DIR, runs COMMAND with its output discarded, records DIR again,
// prints "unchanged" or one "changed: PATH" line per differing entry (in
// bytewise order, "." for DIR itself) and exits 0 (unchanged), 1 (changed)
// or 2 (usage).

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const bytewise = (a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b));

function describe(abs) {
  const st = fs.lstatSync(abs, { bigint: true });
  const meta = `mode ${st.mode} ino ${st.ino} mtime ${st.mtimeNs} ctime ${st.ctimeNs}`;
  if (st.isSymbolicLink()) return `link ${fs.readlinkSync(abs)} ${meta}`;
  if (st.isDirectory()) return `dir ${meta}`;
  if (st.isFile()) {
    const hash = crypto.createHash('sha256').update(fs.readFileSync(abs)).digest('hex');
    return `file ${st.size} ${hash} ${meta}`;
  }
  return `other ${meta}`;
}

// A map from every path under dir ("." for dir itself) to its description.
function record(dir) {
  const out = new Map();
  const walk = (abs, rel) => {
    const description = describe(abs);
    out.set(rel, description);
    if (description.startsWith('dir ')) {
      for (const name of fs.readdirSync(abs).sort(bytewise)) {
        walk(path.join(abs, name), rel === '.' ? name : `${rel}/${name}`);
      }
    }
  };
  walk(dir, '.');
  return out;
}

// The paths whose entries differ between two records, in bytewise order.
function changes(before, after) {
  const paths = new Set([...before.keys(), ...after.keys()]);
  return [...paths].filter((p) => before.get(p) !== after.get(p)).sort(bytewise);
}

// The inode in a description, or null for a missing entry.
function inode(description) {
  const m = description === undefined ? null : / ino (\d+) /.exec(description);
  return m ? m[1] : null;
}

module.exports = { changes, inode, record };

if (require.main === module) {
  const argv = process.argv.slice(2);
  if (argv.length < 3 || argv[1] !== '--') {
    process.stderr.write('usage: node k-context-commit-index-overlay__tree.js DIR -- COMMAND [ARG...]\n');
    process.exit(2);
  }
  const before = record(argv[0]);
  const r = spawnSync(argv[2], argv.slice(3), { stdio: 'ignore' });
  if (r.error) {
    process.stderr.write(`cannot run ${argv[2]}: ${r.error.message}\n`);
    process.exit(2);
  }
  const changed = changes(before, record(argv[0]));
  process.stdout.write(changed.length ? changed.map((p) => `changed: ${p}\n`).join('') : 'unchanged\n');
  process.exit(changed.length ? 1 : 0);
}
