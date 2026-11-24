// Checks the page the build wrote in dist/, and fails naming each problem (see build/output.ts).
//
// Run: npm run output:check, after npm run build. npm run check runs both.

import { existsSync, readFileSync } from 'node:fs';
import { checkOutput, OUTPUT } from '../build/output.ts';

const dist = new URL('../dist/', import.meta.url);
const missing = [OUTPUT, `${OUTPUT}.sha256`].filter((name) => !existsSync(new URL(name, dist)));
for (const name of missing) console.error(`dist/${name}: not found; run npm run build first`);
if (missing.length > 0) process.exit(1);

const page = readFileSync(new URL(OUTPUT, dist), 'utf8');
const hashLine = readFileSync(new URL(`${OUTPUT}.sha256`, dist), 'utf8');
const problems = await checkOutput(OUTPUT, page, hashLine);
for (const problem of problems) console.error(problem);
if (problems.length > 0) process.exit(1);
console.log(`${OUTPUT}: the published page passes its checks`);
