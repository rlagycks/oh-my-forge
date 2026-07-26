'use strict';

const CODEX_CLI_PROVIDER = Object.freeze({
  id: 'codex_cli',
  command: 'codex',
  args: Object.freeze(['exec', '--json', '--sandbox', 'read-only']),
});

module.exports = { CODEX_CLI_PROVIDER };
