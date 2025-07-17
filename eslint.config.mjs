// eslint.config.mjs
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default [
  // ─── ignore JS bundles, build output, etc. ───────────────────────
  {
    ignores: [
      '**/*.js',
      'out/**',
      'dist/**',
      'esbuild.config.mjs',
      'node_modules/**',
      '.vscode-test.mjs',
      'spec_example/**',
      'topoViewerEditor/**'
    ]
  },

  // ─── base JS/JSON files ──────────────────────────────────────────
  eslint.configs.recommended,

  // ─── TypeScript files ───────────────────────────────────────────
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        project: ['./tsconfig.json', './test/tsconfig.json'],
        ecmaVersion: 'latest',
        sourceType: 'module'
      },
      globals: {
        console: 'readonly',
        process: 'readonly',
        Buffer: 'readonly',
        require: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        window: 'readonly',
        document: 'readonly',
        fetch: 'readonly',
        URLSearchParams: 'readonly',
        URL: 'readonly',
        getComputedStyle: 'readonly'
      }
    },
    plugins: { '@typescript-eslint': tseslint.plugin },
    rules: {
      // merge recommended rules + type-checked rules
      ...tseslint.configs.recommended.rules,
      ...tseslint.configs.recommendedTypeChecked.rules,

      // disallow trailing whitespace
      'no-trailing-spaces': ['error', {
        skipBlankLines: false,
        ignoreComments: false
      }],

      // turn off core unused-vars and use the TS-aware one
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          vars: 'all',
          args: 'after-used',
          ignoreRestSiblings: true,
          argsIgnorePattern: '^_',    // allow unused args named _foo
          varsIgnorePattern: '^_'     // allow unused vars named _bar
        }
      ]
    }
  },

  // ─── tests ───────────────────────────────────────────────────────
  {
    files: ['test/**/*.ts'],
    languageOptions: {
      globals: {
        describe: 'readonly',
        it: 'readonly',
        before: 'readonly',
        after: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly',
        __dirname: 'readonly'
      }
    }
  }
];
