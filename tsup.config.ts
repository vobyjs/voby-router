import { defineConfig } from 'tsup';

export default defineConfig({
  clean: true,
  dts: true,
  entry: ['src/index.tsx'],
  minify: true,
  sourcemap: true,
  format: ['esm'],
});
