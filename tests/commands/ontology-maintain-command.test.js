'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const commandPath = path.join(__dirname, '../../commands/ontology-maintain.md');

function main() {
  console.log('\nontology-maintain-command.test.js');
  const command = fs.readFileSync(commandPath, 'utf8');
  assert.match(command, /--provider <claude_code\|codex_cli>/);
  assert.match(command, /never select a fallback provider or call one provider from the other/i);
  assert.match(command, /`shell: false`/);
  assert.match(command, /never applies the proposal, changes project files, or enables a hook/i);
  assert.match(command, /Do not add this command to PostToolUse, Stop, or SessionEnd hooks/i);
  console.log('  PASS documents explicit provider, proposal-only, and no-hook boundaries');
}

try {
  main();
} catch (error) {
  console.error(error);
  process.exit(1);
}
