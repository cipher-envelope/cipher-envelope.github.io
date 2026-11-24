import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { sha256Hex, withPolicy } from './build/csp.ts';

const OUTPUT = 'cipher-envelope.html';

// After everything is inlined: add the policy, rename the page, and publish its SHA-256 beside it.
function offlineFile(): Plugin {
  return {
    name: 'cipher-envelope:offline-file',
    apply: 'build',
    enforce: 'post',
    // The single-file plugin inlines in a generateBundle hook ordered 'post'. This one is ordered
    // 'post' too and listed after it, so it sees the page with its script already inlined.
    generateBundle: {
      order: 'post',
      async handler(_options, bundle) {
        const page = bundle['index.html'];
        if (!page || page.type !== 'asset') throw new Error('index.html: not produced by the build');
        const { html } = await withPolicy(String(page.source), OUTPUT);
        delete bundle['index.html'];
        this.emitFile({ type: 'asset', fileName: OUTPUT, source: html });
        const hash = await sha256Hex(new TextEncoder().encode(html));
        this.emitFile({ type: 'asset', fileName: `${OUTPUT}.sha256`, source: `${hash}  ${OUTPUT}\n` });
      },
    },
  };
}

export default defineConfig({
  build: { target: 'es2022', reportCompressedSize: false },
  plugins: [viteSingleFile({ removeViteModuleLoader: true }), offlineFile()],
  // restoreMocks: a spy set up in one test is never still in place for the next.
  test: { environment: 'node', include: ['test/**/*.test.ts'], restoreMocks: true },
});
