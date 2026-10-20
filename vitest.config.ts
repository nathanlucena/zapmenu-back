import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // Sem isso, depois de um `npm run build` os testes compilados em dist/ rodam de novo.
    exclude: ['**/node_modules/**', 'dist/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.types.ts', 'src/main.ts', 'src/**/__mocks__/**'],
    },
  },
});
