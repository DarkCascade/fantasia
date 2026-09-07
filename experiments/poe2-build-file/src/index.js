'use strict';

const fs = require('fs');
const passives = require('./passives');
const gems = require('./gems');
const uniques = require('./uniques');
const { schema, validateBuild } = require('./schema');
const { assembleBuildFile } = require('./buildFile');

// Writes an already-assembled (and ideally already-validated) build object
// to a .build file. Throws rather than silently writing an invalid file if
// the caller skipped validation and it fails.
function writeBuildFile(build, outPath) {
  const { valid, errors } = validateBuild(build);
  if (!valid) {
    throw new Error(`Refusing to write an invalid .build file:\n${JSON.stringify(errors, null, 2)}`);
  }
  fs.writeFileSync(outPath, JSON.stringify(build, null, 2));
}

module.exports = {
  passives,
  gems,
  uniques,
  schema,
  validateBuild,
  assembleBuildFile,
  writeBuildFile,
};
