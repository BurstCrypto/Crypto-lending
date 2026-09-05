import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(eslint.configs.recommended, ...tseslint.configs.recommended, {
  files: [
    'job-envelope-rollout-preflight.ts',
    'job-envelope-rollout-preflight.test.ts',
    'production-evidence-bundle.ts',
    'production-evidence-bundle.test.ts',
    'production-deployment-target.ts',
    'production-go-live-preflight.ts',
    'production-go-live-preflight.test.ts',
    'public-launch-authority-decision.ts',
    'public-launch-authority-decision.test.ts',
  ],
  languageOptions: {
    parserOptions: {
      project: '../tsconfig.production-preflight.json',
      tsconfigRootDir: import.meta.dirname,
    },
  },
  rules: {
    '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
    '@typescript-eslint/explicit-function-return-type': ['error', { allowExpressions: true }],
    '@typescript-eslint/no-explicit-any': 'error',
  },
});
