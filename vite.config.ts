import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { sha256Hex, withPolicy } from './build/csp.ts';
import { bundledPackages, fontNotices, noticesComment, packageNotices, withNotices } from './build/notices.ts';
import { OUTPUT } from './build/output.ts';

/** The folder of the fonts the repository ships, with their licences, from the project's root. */
const FONTS = 'src/fonts';

// After everything is inlined: add the third-party notices and the policy, rename the page, and
// publish its SHA-256 beside it.
function offlineFile(): Plugin {
  let root = '';
  return {
    name: 'cipher-envelope:offline-file',
    apply: 'build',
    enforce: 'post',
    configResolved(config) {
      root = config.root;
    },
    // The single-file plugin inlines in a generateBundle hook ordered 'post'. This one is ordered
    // 'post' too and listed after it, so it sees the page with its script already inlined.
    generateBundle: {
      order: 'post',
      async handler(_options, bundle) {
        const page = bundle['index.html'];
        if (!page || page.type !== 'asset') throw new Error('index.html: not produced by the build');
        // The notices of every package the build read, and of the fonts the repository ships.
        const notices = noticesComment([
          ...(await packageNotices(this.fs, bundledPackages(this.getModuleIds()))),
          ...(await fontNotices(this.fs, `${root}/${FONTS}/`, FONTS)),
        ]);
        const { html } = await withPolicy(withNotices(String(page.source), notices), OUTPUT);
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
