// @ts-check
import eslint from '@eslint/js';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/**
 * max-params 4 for the functions we write. Core `max-params` cannot exempt Nest DI constructors (66 of them)
 * or route handlers whose parameters are all decorators (`@Param`, `@Query`, `@Req`), so the rule is a selector.
 */
const MAX_PARAMS_SELECTOR =
  ":function[params.length>4]:not(MethodDefinition[kind='constructor'] > FunctionExpression):not(:function[params.0.decorators.length>0])";

export default tseslint.config(
  {
    ignores: ['eslint.config.mjs'],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  eslintPluginPrettierRecommended,
  {
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.jest,
      },
      sourceType: 'commonjs',
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-floating-promises': 'warn',
      '@typescript-eslint/no-unsafe-argument': 'warn',
      'id-length': ['error', { min: 2, properties: 'never' }],
      "prettier/prettier": ["error", { endOfLine: "auto" }],
    },
  },
  {
    rules: {
      complexity: ['error', 15],
      'max-lines-per-function': [
        'error',
        { max: 80, skipBlankLines: true, skipComments: true },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: MAX_PARAMS_SELECTOR,
          message:
            'max-params: more than 4 parameters; group them in an options object.',
        },
      ],
    },
  },
  {
    // Specs and the spec-only harness read as tables of cases; length is not what makes them hard to follow.
    files: ['**/*.spec.ts', '**/*.e2e-spec.ts', 'apps/*/test/**/*.ts'],
    rules: { 'max-lines-per-function': 'off' },
  },
  {
    // `libs/<lib>/src/testing.ts` is the lib's test-support entry; production code never imports it.
    files: ['apps/*/src/**/*.ts', 'libs/*/src/**/*.ts'],
    ignores: ['**/*.spec.ts', '**/*.e2e-spec.ts', 'libs/*/src/testing.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@libs/*/testing'],
              message: 'Test-support entry: import it from specs and apps/*/test only.',
            },
          ],
        },
      ],
    },
  },
);
