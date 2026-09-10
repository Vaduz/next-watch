// @ts-check
//
// Two things this config is here to do:
//
//   1. Stop functions and files from growing past the point where they can be read at once.
//      Thresholds are ESLint *maxima*, so "fail at 50" is written as 49.
//   2. Keep the dependency direction core -> io -> cli. `core` is pure (no process, no
//      terminal, no network), `io` talks to the outside, `cli` composes the two. Without a
//      machine check the direction erodes one import at a time.
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';

/** `src/core/` is pure. It may not reach for the outside world or for the composition root. */
const CORE_MAY_NOT_IMPORT = ['../io', '../io/*', '../io/**', '../cli', '../cli/*', '../cli/**'];

/** `src/io/` talks to the outside world, but it is still a library: it does not know the CLI. */
const IO_MAY_NOT_IMPORT = ['../cli', '../cli/*', '../cli/**'];

export default defineConfig(
  { ignores: ['dist/**', 'node_modules/**', 'bin/**'] },
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      // Blank lines and comments are not counted: explaining a decision must not push a file
      // towards the limit.
      'max-lines': ['error', { max: 199, skipBlankLines: true, skipComments: true }],
      'max-lines-per-function': ['error', { max: 49, skipBlankLines: true, skipComments: true }],
      complexity: ['error', 14],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/explicit-function-return-type': ['error', { allowExpressions: true }],
      // Numbers, booleans and nullish read fine in a template literal; `any` does not, because
      // that is the one that hides a wrong type.
      '@typescript-eslint/restrict-template-expressions': [
        'error',
        { allowNumber: true, allowBoolean: true, allowNullish: true, allowAny: false },
      ],
    },
  },
  {
    files: ['src/core/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: [{ group: CORE_MAY_NOT_IMPORT, message: 'src/core is pure: it does not import io or cli.' }] },
      ],
    },
  },
  {
    files: ['src/io/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: [{ group: IO_MAY_NOT_IMPORT, message: 'src/io is a library layer: it does not import cli.' }] },
      ],
    },
  },
  {
    // describe/it nesting is the structure of a test, so function and file length say nothing
    // useful about it.
    files: ['**/*.test.ts'],
    rules: { 'max-lines': 'off', 'max-lines-per-function': 'off' },
  },
  {
    files: ['*.mjs', '*.ts'],
    ignores: ['src/**'],
    ...tseslint.configs.disableTypeChecked,
  },
);
