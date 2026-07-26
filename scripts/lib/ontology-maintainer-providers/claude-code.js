'use strict';

const CLAUDE_CODE_PROVIDER = Object.freeze({
  id: 'claude_code',
  command: 'claude',
  args: Object.freeze(['--print', '--output-format', 'json', '--permission-mode', 'plan']),
});

module.exports = { CLAUDE_CODE_PROVIDER };
