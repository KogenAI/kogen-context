'use strict';

// A JSON Schema (draft 2020-12) validator for exactly the keywords the
// kogen-context version 1 contract schemas use. Any other keyword is refused,
// so a schema outside this subset cannot pass by being ignored.
//
// Command line (observer controls):
//   node k-context-cli-contract__schema.js FEATURE SCHEMA_PATH DOCUMENT_JSON
// validates DOCUMENT_JSON against the schema docstring that FEATURE pins with
// the step `the file "SCHEMA_PATH" holds JSON:`.

const fs = require('node:fs');

const KEYWORDS = new Set([
  '$schema', '$id', 'title', 'description', '$defs', '$ref', 'type', 'const', 'enum',
  'properties', 'required', 'additionalProperties', 'items', 'minimum', 'maximum',
  'minLength', 'maxLength', 'maxItems', 'oneOf',
]);

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// JSON equality: object members in any order, arrays in order.
function sameJson(a, b) {
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => sameJson(x, b[i]));
  }
  if (isObject(a) || isObject(b)) {
    if (!isObject(a) || !isObject(b)) return false;
    const ka = Object.keys(a).sort();
    const kb = Object.keys(b).sort();
    return sameJson(ka, kb) && ka.every((k) => sameJson(a[k], b[k]));
  }
  return a === b;
}

function hasType(value, type) {
  switch (type) {
    case 'object': return isObject(value);
    case 'array': return Array.isArray(value);
    case 'string': return typeof value === 'string';
    case 'boolean': return typeof value === 'boolean';
    case 'integer': return Number.isInteger(value);
    case 'number': return typeof value === 'number';
    case 'null': return value === null;
    default: throw new Error(`unsupported schema type ${JSON.stringify(type)}`);
  }
}

function resolve(root, ref) {
  if (typeof ref !== 'string' || !ref.startsWith('#/')) throw new Error(`unsupported $ref ${JSON.stringify(ref)}`);
  let node = root;
  for (const part of ref.slice(2).split('/')) {
    if (!isObject(node) || !(part in node)) throw new Error(`unresolved $ref ${ref}`);
    node = node[part];
  }
  return node;
}

function check(root, schema, value, at, errors) {
  const here = at || '/';
  if (schema === true) return;
  if (schema === false) {
    errors.push(`${here}: no value is allowed`);
    return;
  }
  if (!isObject(schema)) throw new Error(`schema for ${here} is not an object`);
  for (const k of Object.keys(schema)) {
    if (!KEYWORDS.has(k)) throw new Error(`unsupported schema keyword ${k}`);
  }
  if ('$ref' in schema) check(root, resolve(root, schema.$ref), value, at, errors);
  if ('type' in schema && !hasType(value, schema.type)) {
    errors.push(`${here}: expected ${schema.type}, got ${JSON.stringify(value)}`);
    return;
  }
  if ('const' in schema && !sameJson(value, schema.const)) {
    errors.push(`${here}: expected ${JSON.stringify(schema.const)}, got ${JSON.stringify(value)}`);
  }
  if ('enum' in schema && !schema.enum.some((e) => sameJson(value, e))) {
    errors.push(`${here}: ${JSON.stringify(value)} is not one of ${JSON.stringify(schema.enum)}`);
  }
  if (typeof value === 'string') {
    const length = [...value].length;
    if ('minLength' in schema && length < schema.minLength) errors.push(`${here}: shorter than ${schema.minLength} characters`);
    if ('maxLength' in schema && length > schema.maxLength) errors.push(`${here}: longer than ${schema.maxLength} characters`);
  }
  if (typeof value === 'number') {
    if ('minimum' in schema && value < schema.minimum) errors.push(`${here}: ${value} is below ${schema.minimum}`);
    if ('maximum' in schema && value > schema.maximum) errors.push(`${here}: ${value} is above ${schema.maximum}`);
  }
  if (Array.isArray(value)) {
    if ('maxItems' in schema && value.length > schema.maxItems) errors.push(`${here}: more than ${schema.maxItems} items`);
    if ('items' in schema) value.forEach((item, i) => check(root, schema.items, item, `${at}/${i}`, errors));
  }
  if (isObject(value)) {
    for (const name of schema.required || []) {
      if (!(name in value)) errors.push(`${here}: missing member ${JSON.stringify(name)}`);
    }
    const properties = schema.properties || {};
    for (const [name, member] of Object.entries(value)) {
      if (name in properties) check(root, properties[name], member, `${at}/${name}`, errors);
      else if ('additionalProperties' in schema) check(root, schema.additionalProperties, member, `${at}/${name}`, errors);
    }
  }
  if ('oneOf' in schema) {
    const outcomes = schema.oneOf.map((branch) => {
      const branchErrors = [];
      check(root, branch, value, at, branchErrors);
      return branchErrors;
    });
    const passing = outcomes.filter((e) => e.length === 0);
    if (passing.length !== 1) {
      const detail = passing.length ? '' : ` (${outcomes.map((e, i) => `branch ${i}: ${e.join(', ')}`).join('; ')})`;
      errors.push(`${here}: matches ${passing.length} of the ${schema.oneOf.length} oneOf branches, not exactly 1${detail}`);
    }
  }
}

// The validation errors of value against schema; empty when it validates.
function validate(schema, value) {
  const errors = [];
  check(schema, schema, value, '', errors);
  return errors;
}

// The docstring that follows the step pinning schemaPath in a feature file.
function pinnedSchema(featureText, schemaPath) {
  const lines = featureText.split('\n');
  const step = lines.findIndex((l) => l.includes(`the file "${schemaPath}" holds JSON:`));
  if (step < 0 || !lines[step + 1] || lines[step + 1].trim() !== '"""') {
    throw new Error(`no JSON docstring for ${schemaPath}`);
  }
  const indent = lines[step + 1].indexOf('"""');
  const body = [];
  for (let i = step + 2; i < lines.length; i += 1) {
    if (lines[i].trim() === '"""') return JSON.parse(body.join('\n'));
    body.push(lines[i].slice(indent));
  }
  throw new Error(`unterminated JSON docstring for ${schemaPath}`);
}

module.exports = { pinnedSchema, sameJson, validate };

if (require.main === module) {
  try {
    const [feature, schemaPath, document] = process.argv.slice(2);
    const errors = validate(pinnedSchema(fs.readFileSync(feature, 'utf8'), schemaPath), JSON.parse(document));
    process.stdout.write(errors.length ? `invalid: ${errors.join('; ')}\n` : 'valid\n');
    process.exitCode = errors.length ? 1 : 0;
  } catch (e) {
    process.stdout.write(`error: ${e.message}\n`);
    process.exitCode = 2;
  }
}
