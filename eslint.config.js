const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
  {
    ignores: [
      'node_modules/',
      'coverage/',
      'dist/',
      '.claude/',
      '.yarn/',
      'skills/',
      'agents/',
      'commands/',
      'rules/',
      'hooks/',
      'contexts/',
      'docs/',
      'manifests/',
      'mcp-configs/',
      'schemas/',
      '.agents/',
      '.codex/',
      '.codex-plugin/',
      '.claude-plugin/',
    ],
  },
  {
    files: ['scripts/**/*.js', 'tests/**/*.js', 'eslint.config.js'],
    ...js.configs.recommended,
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: {
        ...globals.node,
      },
    },
    rules: {
      ...js.configs.recommended.rules,
      'no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      'no-console': 'off',
    },
  },
];
