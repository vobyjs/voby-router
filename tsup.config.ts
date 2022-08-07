import { defineConfig } from 'tsup';

export default defineConfig({
  clean: true,
  dts: true,
  entry: ['src/index.tsx'],
  format: ['esm'],
  name: 'voby-router',
});
