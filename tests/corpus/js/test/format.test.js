'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { formatRow, formatHeader, isEmpty } = require('../src/lib/format.ts');

test('pads columns', () => {
  assert.strictEqual(formatRow({ id: 7, name: 'alpha' }), '7      alpha       ');
});

test('cuts long names', () => {
  assert.strictEqual(formatRow({ id: 1, name: 'a-name-that-is-too-long' }), '1      a-name-that-');
});

test('header', () => {
  assert.strictEqual(formatHeader(), 'ID     NAME        ');
});

test('empty rows', () => {
  assert.ok(isEmpty({ id: 1, name: '  ' }));
  assert.ok(!isEmpty({ id: 1, name: 'x' }));
});
