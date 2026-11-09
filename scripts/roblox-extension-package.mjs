#!/usr/bin/env node
// Reproducible extension-only, source-map-free unpacked artifact. No installation,
// publishing, network, provider activation or Discord injection.
import assert from 'node:assert/strict';
import { diagnosticBuildDefines } from './diagnostic-build.mjs';
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { contentScripts, extensionVersion, optionalFactHosts } from './roblox-extension-manifest-contract.mjs';
import { assertNativeTradeRead } from './roblox-extension-trade-read-contract.mjs';
const source = resolve('extensions/roblox-limited-trading');
const out = resolve('dist/roblox-extension-final'); mkdirSync(out, { recursive: true });
const artifact = join(out, 'unpacked');
const files = ['background.js', 'content.js', 'manifest.json', 'options.html', 'options.js', 'overlay.css', 'THIRD_PARTY_NOTICES.txt'].sort();
const hash = data => createHash('sha256').update(data).digest('hex');
// Only these reviewed pure modules may cross the extension source boundary.
const sharedSources = ['plugins/lib/robloxLimitedValuation.ts', 'plugins/lib/w8rldData.ts', 'plugins/lib/calculatorCore.ts', 'plugins/lib/safeDiagnostics.ts', 'plugins/lib/diagnosticView.ts', 'plugins/lib/historicalTrade.ts', 'plugins/lib/historicalTradeView.ts', 'plugins/lib/displayPrecision.ts'];
const prohibited = [
  /\b(?:eval|Function|XMLHttpRequest|WebSocket|EventSource|importScripts)\s*\(/,
  /\bimport\s*\(/, /\.\s*(?:cookie|sendBeacon|executeScript|executeJavaScript|onMessageExternal)\b/,
  /\.\s*(?:click|submit|requestSubmit|dispatchEvent)\s*\(/,
  /createElement\s*\(\s*['"](?:script|iframe|webview)['"]/, /\.\s*(?:innerHTML|outerHTML|insertAdjacentHTML)\b/,
  /\.ROBLOSECURITY/, /Authorization\s*:/i,
  /\b(?:localStorage|sessionStorage|indexedDB)\b/, /sourceMappingURL=/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/, /\b(?:sk-proj-|ghp_)[A-Za-z0-9]{20,}/,
];
let assertions = 0;
const check = (value, label) => { assertions++; assert.ok(value, label); };
async function compile(directory) {
  mkdirSync(directory, { recursive: true });
  for (const name of ['background', 'content', 'options']) {
    const result = await build({ entryPoints: [join(source, 'src', `${name}.ts`)], outfile: join(directory, `${name}.js`), bundle: true, sourcemap: false, metafile: true, define: diagnosticBuildDefines('extension'), format: name === 'background' ? 'esm' : 'iife', platform: 'browser', target: 'chrome120' });
    check(Object.keys(result.metafile.inputs).every(f => {
      const path = f.replaceAll('\\', '/');
      return path.startsWith('extensions/roblox-limited-trading/src/') || sharedSources.includes(path);
    }), `${name}: extension and exact reviewed pure dependencies only`);
    check(Object.values(result.metafile.outputs).every(o => o.imports.length === 0), `${name}: no external dependencies`);
    check(name === 'background' || !Object.keys(result.metafile.inputs).some(f => /\/(?:provider|transport)\.ts$/.test(f)), `${name}: transport and scheduler are worker-only`);
  }
  for (const file of ['manifest.json', 'options.html', 'overlay.css', 'THIRD_PARTY_NOTICES.txt']) cpSync(join(source, file), join(directory, file));
  check(JSON.stringify(readdirSync(directory).sort()) === JSON.stringify(files), 'six executable/presentation assets and MIT attribution; no maps or extra files');
  check(readFileSync(join(directory, 'THIRD_PARTY_NOTICES.txt'), 'utf8').includes('Copyright (c) 2026 RoUtility'), 'upstream copyright accompanies redistribution');
  check(readFileSync(join(directory, 'content.js'), 'utf8').includes('Copyright (c) 2026 RoUtility'), 'upstream legal source comments survive bundling');
  const manifest = JSON.parse(readFileSync(join(directory, 'manifest.json'), 'utf8'));
  check(manifest.manifest_version === 3 && manifest.version === extensionVersion, 'reviewed MV3/version');
  const expected = JSON.parse(readFileSync(join(source, 'manifest.json'), 'utf8'));
  check(JSON.stringify(manifest) === JSON.stringify(expected), 'manifest matches authoritative source');
  check(JSON.stringify(manifest.permissions) === '["storage"]' && JSON.stringify(manifest.host_permissions) === '["https://www.rolimons.com/*","https://routility.io/*"]', 'storage and exact provider hosts only');
  check(JSON.stringify(manifest.content_scripts) === JSON.stringify(contentScripts), 'isolated top frame supported documents only');
  check(JSON.stringify(manifest.optional_permissions) === '["notifications"]', 'notifications optional only');
  check(JSON.stringify(manifest.optional_host_permissions) === JSON.stringify(optionalFactHosts), 'public factual origins require explicit optional grants');
  check(Object.keys(manifest).sort().join() === ['manifest_version','name','version','description','permissions','optional_permissions','optional_host_permissions','host_permissions','background','content_scripts','options_page'].sort().join(), 'no extra capabilities, resources or weakened CSP');
  for (const name of ['background.js', 'content.js', 'options.js']) for (const pattern of prohibited) check(!pattern.test(readFileSync(join(directory, name), 'utf8')), `${name}: ${pattern}`);
  for (const name of ['background.js', 'content.js', 'options.js']) assertNativeTradeRead(name,readFileSync(join(directory,name),'utf8'));
  check(readFileSync(join(directory, 'background.js'), 'utf8').includes('credentials: "omit"'), 'credentialless production worker');
  for (const name of ['content.js', 'options.js']) check(!/\bfetch\s*\(/.test(readFileSync(join(directory, name), 'utf8')), `${name}: no network capability`);
  check(!/@import|url\s*\(/i.test(readFileSync(join(directory, 'overlay.css'), 'utf8')), 'CSS has no external resources');
  const html = readFileSync(join(directory, 'options.html'), 'utf8');
  check(!/\bon\w+\s*=|<iframe|javascript:/i.test(html) && [...html.matchAll(/<script\b[^>]*src="([^"]+)"/g)].map(m => m[1]).join() === 'options.js', 'local options execution only');
  return Object.fromEntries(files.map(file => [file, hash(readFileSync(join(directory, file)))]));
}
const identity = await compile(artifact);
const temporary = mkdtempSync(join(tmpdir(), 'w8rld-extension-repro-'));
try {
  const again = await compile(temporary);
  check(JSON.stringify(identity) === JSON.stringify(again), 'two independent builds are byte-identical');
} finally {
  const target = resolve(temporary); assert.ok(target.startsWith(resolve(tmpdir()) + sep) && target.split(/[\\/]/).at(-1).startsWith('w8rld-extension-repro-'));
  rmSync(target, { recursive: true, force: true });
}
// Directory digest v1: sorted UTF-8 filename, NUL, raw bytes, NUL per file.
const digest = createHash('sha256'); for (const file of files) digest.update(file).update('\0').update(readFileSync(join(artifact, file))).update('\0');
const sourceFiles = readdirSync(join(source, 'src'), { recursive: true }).map(f => f.replaceAll('\\', '/')).filter(f => f.endsWith('.ts')).sort();
const evidence = { status: 'PASS', assertions, version: extensionVersion, artifact, sha256: digest.digest('hex'), digestAlgorithm: 'sorted filename + NUL + file bytes + NUL; SHA-256', files: identity, source: Object.fromEntries([...sourceFiles.map(f => `src/${f}`), 'manifest.json', 'options.html', 'overlay.css', 'THIRD_PARTY_NOTICES.txt', ...sharedSources.map(f => `../../${f}`)].map(f => [f, hash(readFileSync(join(source, f)))])), reproducible: true, provider: 'PUBLIC READ-ONLY', sourceMaps: false };
const sourceDigest = createHash('sha256');
for (const file of Object.keys(evidence.source).sort()) sourceDigest.update(file).update('\0').update(readFileSync(join(source, file))).update('\0');
evidence.sourceSha256 = sourceDigest.digest('hex');
writeFileSync(join(out, 'artifact.json'), JSON.stringify(evidence, null, 2) + '\n');
console.log(`Package integrity passed (${assertions} assertions). SHA-256 ${evidence.sha256}`);
