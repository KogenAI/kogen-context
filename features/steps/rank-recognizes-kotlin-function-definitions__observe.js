'use strict';

const assert = require('node:assert/strict');

module.exports = function assertOrder(packet, filename, lines) {
  assert.deepEqual(
    packet.matches.map(({ path, line }) => `${path}:${line}`),
    lines.split(', ').map((line) => `${filename}:${line}`),
    'ranked search match locations, in order',
  );
};
