'use strict';
const { Given, Then, After } = require('@cucumber/cucumber');
const fs = require('node:fs');
const driver = require('./read-directory-path-refusal-test__driver');
const P = 'read-directory-path-refusal-test: ';
Given(P + 'a temporary copy of the CLI integration target', function () {
  this.readDirectoryRefusalCopy = driver.copy();
});
Then(P + 'the CLI integration tests pass with unchanged read behavior', { timeout: 115000 }, function () {
  driver.run(this.readDirectoryRefusalCopy, 'unchanged');
});
Then(P + 'the CLI integration tests reject {string}', { timeout: 115000 }, function (mutation) {
  driver.run(this.readDirectoryRefusalCopy, mutation);
});
After(function () {
  if (this.readDirectoryRefusalCopy) fs.rmSync(this.readDirectoryRefusalCopy, { recursive: true, force: true });
});
