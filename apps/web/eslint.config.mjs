import { defineConfig, globalIgnores } from 'eslint/config';
import { fixupConfigRules } from '@eslint/compat';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTypeScript from 'eslint-config-next/typescript';

export default defineConfig([
  ...fixupConfigRules([...nextVitals, ...nextTypeScript]),
  globalIgnores(['.next/**', 'coverage/**', 'out/**', 'next-env.d.ts']),
]);
