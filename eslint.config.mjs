// eslint.config.mjs  – works with ESLint 9+
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import sonarjs from 'eslint-plugin-sonarjs';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import importPlugin from 'eslint-plugin-import-x';
import boundaries from 'eslint-plugin-boundaries';
import unicorn from 'eslint-plugin-unicorn';
import betterTailwindcss from 'eslint-plugin-better-tailwindcss';

export default [
  /* ─── files & globs ESLint must ignore ─────────────────────────── */
  {
    ignores: [
      '**/*.js',          // ← ignore *all* JavaScript bundles
      'out/**',
      'dist/**',
      'esbuild.config.mjs',
      'node_modules/**',
      '.vscode-test.mjs',
      'spec_example/**',
      'topoViewerEditor/**'
    ]
  },

  /* ---------- every other JS/JSON file ---------- */
  eslint.configs.recommended,   // same as "eslint:recommended"

  /* ---------- TypeScript (syntax + type-aware) ---------- */
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
        getComputedStyle: 'readonly',
        navigator: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly'
      }
    },
    plugins: { '@typescript-eslint': tseslint.plugin, sonarjs, 'import-x': importPlugin, boundaries },
    settings: {
      'boundaries/elements': [
        // Webview layers
        { type: 'webviews-ext', pattern: 'src/webviews/**/*.ts', mode: 'file' },
        { type: 'webviews-react', pattern: 'src/webviews/**/*.tsx', mode: 'file' },
        { type: 'webviews-shared', pattern: 'src/webviews/shared/**', mode: 'file' },
        // Main extension layers
        { type: 'clients', pattern: 'src/clients/**', mode: 'file' },
        { type: 'services', pattern: 'src/services/**', mode: 'file' },
        { type: 'providers', pattern: 'src/providers/**', mode: 'file' },
        { type: 'commands', pattern: 'src/commands/**', mode: 'file' },
        { type: 'utils', pattern: 'src/utils/**', mode: 'file' },
        { type: 'types', pattern: 'src/types/**', mode: 'file' },
      ],
      'boundaries/ignore': ['**/*.test.ts', '**/*.test.tsx', 'src/extension.ts'],
    },
    // merge the two rule-sets
    rules: {
      ...tseslint.configs.recommended.rules,
      ...tseslint.configs.recommendedTypeChecked.rules,
      ...sonarjs.configs.recommended.rules,

      // Use TypeScript's noUnused* diagnostics instead of duplicating in ESLint
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': 'off',

      // disallow any trailing whitespace
      'no-trailing-spaces': ['error', {
        skipBlankLines: false,
        ignoreComments: false
      }],

      // ─── Complexity rules ───
      'complexity': ['error', { max: 15 }],
      'sonarjs/cognitive-complexity': ['error', 15],
      'sonarjs/no-identical-functions': 'error',
      'sonarjs/no-duplicate-string': 'error',
      'sonarjs/no-hardcoded-ip': 'off',
      'sonarjs/no-alphabetical-sort': 'off',
      // Extra SonarJS rules
      'sonarjs/no-nested-template-literals': 'error',
      'sonarjs/prefer-immediate-return': 'warn',
      'sonarjs/no-inverted-boolean-check': 'error',

      // ─── Stricter TypeScript rules ───
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/await-thenable': 'error',

      // ─── Import rules ───
      'import-x/no-duplicates': 'error',
      'import-x/order': ['warn', {
        'groups': ['builtin', 'external', 'internal', 'parent', 'sibling', 'index'],
        'newlines-between': 'always'
      }],
      'import-x/no-useless-path-segments': ['error', { noUselessIndex: true }],
      'import-x/max-dependencies': ['warn', { max: 15 }],

      // ─── Consistent type imports ───
      '@typescript-eslint/consistent-type-imports': ['error', {
        prefer: 'type-imports',
        fixStyle: 'separate-type-imports',
      }],

      // ─── Module boundary rules ───
      'boundaries/element-types': ['error', {
        default: 'disallow',
        rules: [
          // Webview layer boundaries
          { from: 'webviews-ext', allow: ['webviews-ext', 'webviews-shared', 'clients', 'services', 'providers', 'commands', 'utils', 'types'] },
          { from: 'webviews-react', allow: ['webviews-react', 'webviews-shared', 'utils', 'types'] },
          { from: 'webviews-shared', allow: ['webviews-shared', 'utils', 'types'] },
          // Main extension layer boundaries
          { from: 'commands', allow: ['commands', 'clients', 'services', 'providers', 'utils', 'types', 'webviews-ext'] },
          { from: 'providers', allow: ['providers', 'clients', 'services', 'utils', 'types'] },
          { from: 'services', allow: ['services', 'clients', 'utils', 'types'] },
          { from: 'clients', allow: ['clients', 'utils', 'types'] },
          { from: 'utils', allow: ['utils', 'types'] },
          { from: 'types', allow: ['types'] },
        ],
      }],

      // ─── Cross-layer import restrictions ───
      'import-x/no-restricted-paths': ['error', {
        zones: [
          // Webview React side cannot import from extension-side
          {
            target: './src/webviews/**/*.tsx',
            from: './src/clients/**/*',
            message: 'Webview React files cannot import from clients layer',
          },
          {
            target: './src/webviews/**/*.tsx',
            from: './src/services/**/*',
            message: 'Webview React files cannot import from services layer',
          },
          {
            target: './src/webviews/**/*.tsx',
            from: './src/providers/**/*',
            message: 'Webview React files cannot import from providers layer',
          },
          {
            target: './src/webviews/**/*.tsx',
            from: './src/commands/**/*',
            message: 'Webview React files cannot import from commands layer',
          },
          // Providers cannot import from commands
          {
            target: './src/providers/**/*',
            from: './src/commands/**/*',
            message: 'Providers cannot import from Commands. Use Services layer.',
          },
        ],
      }],

      // ─── Type safety rules (warnings for gradual adoption) ───
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unsafe-assignment': 'warn',
      '@typescript-eslint/no-unsafe-member-access': 'warn',
      '@typescript-eslint/no-unsafe-call': 'warn',
      '@typescript-eslint/no-unsafe-return': 'warn',

      // ─── Complexity and readability rules ───
      'no-nested-ternary': 'error',
      'max-params': ['warn', { max: 10 }],
      'no-console': ['warn', { allow: ['warn', 'error'] }],

      // ─── Ban wildcard re-exports ───
      'no-restricted-syntax': [
        'error',
        {
          selector: 'ExportAllDeclaration',
          message: 'Use named re-exports instead of "export * from"'
        }
      ],
    },
  },

  /* ---------- Ban re-exports outside index.ts ---------- */
  {
    files: ['src/**/*.ts', 'src/**/*.tsx'],
    ignores: ['**/index.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'ExportNamedDeclaration[source]',
          message: 'Re-exports only allowed in index.ts files'
        },
        {
          selector: 'ExportAllDeclaration',
          message: 'Use named re-exports instead of "export * from"'
        }
      ]
    }
  },

  /* ---------- Webviews: max-lines limit ---------- */
  {
    files: ['src/webviews/**/*.ts', 'src/webviews/**/*.tsx'],
    rules: {
      'max-lines': ['error', { max: 1000, skipBlankLines: true, skipComments: true }]
    }
  },

  /* ---------- React & Hooks rules for webview ---------- */
  {
    files: ['src/webviews/**/*.tsx'],
    plugins: { react, 'react-hooks': reactHooks, 'better-tailwindcss': betterTailwindcss },
    settings: {
      react: { version: 'detect' },
      'better-tailwindcss': { entryPoint: 'src/styles/tailwind-input.css' }
    },
    rules: {
      ...react.configs.recommended.rules,
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'react/react-in-jsx-scope': 'off',  // Not needed in React 17+
      'react/prop-types': 'off',          // Using TypeScript
      // Tailwind CSS rules (better-tailwindcss supports v4)
      'better-tailwindcss/no-duplicate-classes': 'warn',
      'better-tailwindcss/no-conflicting-classes': 'warn',
      'better-tailwindcss/no-deprecated-classes': 'warn',
      'better-tailwindcss/enforce-shorthand-classes': 'warn',
      'better-tailwindcss/no-unknown-classes': ['warn', {
        ignore: ['^codicon', '^vscode-', '^query-', '^copy-']
      }],
    }
  },

  /* ---------- Filename conventions: React components (PascalCase) ---------- */
  {
    files: ['src/webviews/**/components/**/*.tsx'],
    plugins: { unicorn },
    rules: {
      'unicorn/filename-case': ['error', { case: 'pascalCase' }],
    }
  },

  /* ---------- Filename conventions: Hooks (camelCase) ---------- */
  {
    files: ['src/webviews/**/hooks/**/*.ts'],
    plugins: { unicorn },
    rules: {
      'unicorn/filename-case': ['error', {
        case: 'camelCase',
        ignore: ['^index\\.ts$'],
      }],
    }
  },

  /* ---------- Test files: relax type safety rules ---------- */
  {
    files: ['test/**/*.ts', 'test/**/*.tsx', '**/*.test.ts', '**/*.test.tsx'],
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
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      'no-console': 'off',
    }
  }
];
