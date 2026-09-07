'use strict';

const fs = require('fs');
const path = require('path');
// Plain `ajv` only understands draft-07 out of the box; this schema
// declares 2020-12 (matching the community schema it's based on), which
// needs Ajv's dedicated 2020-12 build or `ajv.compile()` throws "no schema
// with key or ref" instead of validating anything.
const Ajv2020 = require('ajv/dist/2020');

const schema = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'poe2-build.schema.json'), 'utf8'));

const ajv = new Ajv2020({ allErrors: true, strict: false });
const validateFn = ajv.compile(schema);

// Validates a plain object against the .build schema. Returns
// { valid: true } or { valid: false, errors: [...] } (Ajv's raw error
// objects — each has .instancePath/.message) rather than throwing, since a
// caller assembling a build interactively wants to report every problem at
// once, not stop at the first.
function validateBuild(buildObject) {
  const valid = validateFn(buildObject);
  return valid ? { valid: true, errors: [] } : { valid: false, errors: validateFn.errors };
}

module.exports = { schema, validateBuild };
