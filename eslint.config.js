const vue = require('@typescript-eslint/eslint-plugin');
const parserVue = require('@typescript-eslint/parser');

module.exports = [
  {
    files: ['**/*'],
    languageOptions: {
      parser: parserVue,
      ecmaVersion: 'latest',
      sourceType: 'module',
      ecmaFeatures: {
        jsx: true,
      },
    },
    plugins: {
      vue: vue,
    },
    rules: {
      'vue/multi-word-component-names': 'off',
    },
  },
];
