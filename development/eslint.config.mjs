import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    // Standalone submission builds keep their original browser globals and style.
    // SubmittedAssetIntegrity.test.ts checks the generated scripts and resources;
    // application components and the source preparation tools stay separately checked.
    ignores: [
      '**/dist/**',
      '**/dist-review/**',
      '**/node_modules/**',
      'apps/web/public/organization-showcase/sites/**',
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
);
