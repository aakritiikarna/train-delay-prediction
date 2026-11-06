'use strict';
const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
  { ignores: ['node_modules/', 'public/vendor/**', 'ai/.venv/**'] },
  js.configs.recommended,
  { files: ['**/*.js'], languageOptions: { sourceType: 'commonjs', globals: globals.node } },
  { files: ['public/js/**/*.js'], languageOptions: { sourceType: 'script', globals: { ...globals.browser, io: 'readonly', Chart: 'readonly' } } },
  { files: ['tests/e2e/smoke.manual.js'], languageOptions: { globals: { document: 'readonly', innerWidth: 'readonly' } } },
];
