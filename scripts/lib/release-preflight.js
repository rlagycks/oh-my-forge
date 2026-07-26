'use strict';

function findWorktreeChanges(statusOutput) {
  return String(statusOutput || '')
    .split(/\r?\n/)
    .filter(line => line.length > 0);
}

module.exports = {
  findWorktreeChanges,
};
