'use strict';

// Steps of the Intent context-search-stops-reading-non-text-files. They copy
// the crate (Cargo.toml, Cargo.lock, rust-toolchain.toml, src/) to a scratch
// directory, append a test module of their own to the copy's src/main.rs that
// calls `read_utf8_blocks` with in-memory readers, and run single tests of it
// with cargo. The checkout is never written.

const { After, AfterAll, Given, Then, When } = require('@cucumber/cucumber');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const P = 'context-search-stops-reading-non-text-files: ';
const repoRoot = path.resolve(__dirname, '..', '..');
const shared = fs.mkdtempSync(path.join(os.tmpdir(), 'csrnt-'));
const targetDir = path.join(shared, 'target');
let copies = 0;

const CURRENT_BEHAVIOR = String.raw`
#[cfg(test)]
fn read_utf8_blocks(mut reader: impl std::io::Read) -> Option<String> {
    let mut bytes = Vec::new();
    reader.read_to_end(&mut bytes).ok()?;
    String::from_utf8(bytes).ok()
}
`;

const TEST_MODULE = String.raw`
#[cfg(test)]
mod reads_text_blocks_acceptance {
    use super::*;
    use std::cell::Cell;
    use std::io::{self, Read};
    use std::rc::Rc;

    struct Counting {
        len: usize,
        byte: Box<dyn Fn(usize) -> u8>,
        fail_at: Option<usize>,
        position: usize,
        handed: Rc<Cell<usize>>,
    }

    impl Counting {
        fn new(len: usize, byte: impl Fn(usize) -> u8 + 'static) -> (Self, Rc<Cell<usize>>) {
            let handed = Rc::new(Cell::new(0));
            let reader = Counting {
                len,
                byte: Box::new(byte),
                fail_at: None,
                position: 0,
                handed: handed.clone(),
            };
            (reader, handed)
        }
    }

    impl Read for Counting {
        fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
            if self.fail_at == Some(self.position) {
                return Err(io::Error::other("injected read failure"));
            }
            let end = self.fail_at.unwrap_or(self.len);
            let count = buf.len().min(end - self.position);
            for (offset, slot) in buf[..count].iter_mut().enumerate() {
                *slot = (self.byte)(self.position + offset);
            }
            self.position += count;
            self.handed.set(self.handed.get() + count);
            Ok(count)
        }
    }

    #[test]
    fn reads_text_blocks_stops_at_the_first_invalid_block() {
        let (reader, handed) = Counting::new(10_485_760, |i| if i == 0 { 0xFF } else { b'a' });
        assert_eq!(read_utf8_blocks(reader), None);
        assert!(handed.get() <= 65_536, "handed out {} bytes", handed.get());
    }

    #[test]
    fn reads_text_blocks_finds_an_invalid_byte_in_a_later_block() {
        let (reader, handed) = Counting::new(196_608, |i| if i == 100_000 { 0xFF } else { b'a' });
        assert_eq!(read_utf8_blocks(reader), None);
        assert!(handed.get() <= 131_072, "handed out {} bytes", handed.get());
    }

    #[test]
    fn reads_text_blocks_accepts_a_character_across_a_block_boundary() {
        let mut bytes = vec![b'a'; 65_535];
        bytes.extend_from_slice("ébc".as_bytes());
        let expected = format!("{}ébc", "a".repeat(65_535));
        assert_eq!(bytes[65_535], 0xC3);
        assert_eq!(read_utf8_blocks(io::Cursor::new(bytes)), Some(expected));
    }

    #[test]
    fn reads_text_blocks_refuses_an_incomplete_final_character() {
        let mut bytes = b"abc".to_vec();
        bytes.push(0xC3);
        assert_eq!(read_utf8_blocks(io::Cursor::new(bytes)), None);
    }

    #[test]
    fn reads_text_blocks_gives_nothing_when_the_read_fails() {
        let (mut reader, _) = Counting::new(1_000, |_| b'a');
        reader.fail_at = Some(1_000);
        assert_eq!(read_utf8_blocks(reader), None);
    }
}
`;

After(function () {
  const s = this.csrnt;
  if (s && s.dir) fs.rmSync(s.dir, { recursive: true, force: true });
});

AfterAll(function () {
  fs.rmSync(shared, { recursive: true, force: true });
});

function copyCrate(world) {
  const dir = path.join(shared, `copy-${(copies += 1)}`);
  fs.mkdirSync(dir);
  for (const name of ['Cargo.toml', 'Cargo.lock', 'rust-toolchain.toml']) {
    fs.copyFileSync(path.join(repoRoot, name), path.join(dir, name));
  }
  fs.cpSync(path.join(repoRoot, 'src'), path.join(dir, 'src'), { recursive: true });
  const mainPath = path.join(dir, 'src', 'main.rs');
  // Until the function exists, the copy gets today's behavior (fs::read followed by String::from_utf8) in its
  // place, so that the scenarios fail on the property they assert and not on a missing name.
  const missing = !/fn read_utf8_blocks\b/.test(fs.readFileSync(mainPath, 'utf8'));
  fs.appendFileSync(mainPath, (missing ? CURRENT_BEHAVIOR : '') + TEST_MODULE);
  world.csrnt = { dir };
}

Given(P + 'the block reader tests are added to a scratch copy of the crate', function () {
  copyCrate(this);
});

When(P + 'the test {word} is run in the scratch copy', { timeout: 115000 }, function (name) {
  const s = this.csrnt;
  const args = ['test', '--locked', '--offline', '--bin', 'kogen-context', `reads_text_blocks_acceptance::${name}`, '--', '--exact'];
  const r = spawnSync('cargo', args, {
    cwd: s.dir,
    encoding: 'utf8',
    timeout: 110000,
    env: { ...process.env, CARGO_TARGET_DIR: targetDir },
  });
  s.run = { name, args, status: r.status, signal: r.signal, error: r.error, output: `${r.stdout}${r.stderr}` };
});

Then(P + 'the test {word} passed', function (name) {
  const run = this.csrnt.run;
  assert.ok(run && run.name === name, `the test ${name} was not run`);
  const where = `cargo ${run.args.join(' ')} in ${this.csrnt.dir} (status ${run.status}, signal ${run.signal}, error ${run.error}):\n${run.output}`;
  assert.equal(run.status, 0, `the test ${name} did not pass: ${where}`);
  assert.ok(
    run.output.includes(`test reads_text_blocks_acceptance::${name} ... ok`),
    `the test ${name} did not run or was not ok: ${where}`,
  );
  assert.ok(run.output.includes('test result: ok. 1 passed;'), `the test ${name} was not the one test run: ${where}`);
});

function between(text, from, to) {
  const start = text.indexOf(from);
  assert.notEqual(start, -1, `${from} not found`);
  const end = text.indexOf(to, start);
  assert.notEqual(end, -1, `${to} not found after ${from}`);
  return text.slice(start, end);
}

Then(P + 'find_matches, find_ranked_matches and read_lines read files with read_utf8_blocks instead of fs::read', function () {
  const main = fs.readFileSync(path.join(repoRoot, 'src', 'main.rs'), 'utf8');
  const rank = fs.readFileSync(path.join(repoRoot, 'src', 'rank.rs'), 'utf8');
  const bodies = {
    find_matches: between(main, 'fn find_matches(', '\nfn search('),
    read_lines: between(main, 'fn read_lines(', '#[cfg(test)]'),
    find_ranked_matches: between(rank, 'pub fn find_ranked_matches(', '#[cfg(test)]'),
  };
  for (const [name, body] of Object.entries(bodies)) {
    assert.ok(body.includes('read_utf8_blocks'), `${name} does not call read_utf8_blocks`);
    assert.ok(!body.includes('fs::read('), `${name} still calls fs::read`);
    assert.ok(!body.includes('String::from_utf8('), `${name} still calls String::from_utf8`);
  }
});
