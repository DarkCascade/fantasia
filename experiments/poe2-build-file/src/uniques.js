'use strict';

const fs = require('fs');
const path = require('path');

let _index = null;
function loadIndex() {
  if (!_index) {
    _index = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'index', 'uniques.json'), 'utf8'));
  }
  return _index;
}

// unique_name in a .build file is just the item's plain display name (no
// internal id involved) — this is a sanity check, not a lookup: confirms
// the name is real and returns its item class for a quick cross-check
// against the inventory_id it's being attached to.
function findUnique(name) {
  const index = loadIndex();
  return index[name] || null;
}

module.exports = { loadIndex, findUnique };
