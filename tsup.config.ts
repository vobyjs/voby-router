import { defineConfig } from 'tsup';
import voby from 'voby-esbuild';

export default defineConfig({
  clean: true,
  dts: true,
  entry: ['src/index.tsx'],
  esbuildPlugins: [voby()],
  format: ['esm'],
  name: 'voby-router',
});
