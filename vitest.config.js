import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // public/ holds generated copies of assets/; running the copies would
    // double every assertion and hide a stale build behind a passing suite.
    exclude: ['node_modules/**', 'public/**', '.design/**'],
  },
});
