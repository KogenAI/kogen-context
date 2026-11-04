'use strict';

const { formatRow, formatHeader } = require('./lib/format.ts');
const { catalog } = require('./generated/catalog.js');

// Prints the naïve report: the header, then one line per catalog row.
function main(argv) {
  const rows = argv.includes('--short') ? catalog.slice(0, 5) : catalog;
  const lines = [formatHeader()];
  for (const row of rows) {
    lines.push(formatRow(row));
  }
  lines.push(`${rows.length} rows`);
  return lines.join('\n');
}

if (require.main === module) {
  process.stdout.write(`${main(process.argv.slice(2))}\n`);
}

module.exports = { main };
