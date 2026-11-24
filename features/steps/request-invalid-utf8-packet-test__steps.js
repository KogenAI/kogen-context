'use strict';
const { Given, Then, After } = require('@cucumber/cucumber');
const fs = require('node:fs');
const driver = require('./request-invalid-utf8-packet-test__driver');
const P = 'request-invalid-utf8-packet-test: ';
Given(P + 'a temporary copy of the contract integration target', function () {
  this.invalidUtf8PacketCopy = driver.copy();
});
Then(P + 'the contract tests pass with unchanged request handling', { timeout: 115000 }, function () {
  driver.run(this.invalidUtf8PacketCopy, 'unchanged');
});
Then(P + 'the contract tests reject a non-UTF-8-only regression in {string}', { timeout: 115000 }, function (mutation) {
  driver.run(this.invalidUtf8PacketCopy, mutation);
});
After(function () {
  if (this.invalidUtf8PacketCopy) fs.rmSync(this.invalidUtf8PacketCopy, { recursive: true, force: true });
});
