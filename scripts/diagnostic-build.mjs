// Public, deterministic artifact identities. No environment/account inputs.
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
export function diagnosticBuildDefines(product = 'all') {
  if (!['all', 'extension', 'bot'].includes(product)) throw Error('Unknown diagnostic build product');
  const digest = (roots, assets = []) => {
    const files = [];
    const walk = path => {
      for (const entry of readdirSync(path, { withFileTypes: true })) {
        const file = join(path, entry.name).replaceAll('\\', '/');
        if (entry.isDirectory()) walk(file); else if (entry.isFile() && /\.ts$/.test(file)) files.push(file);
      }
    };
    roots.forEach(walk);
    files.push('plugins/lib/safeDiagnostics.ts', 'plugins/lib/diagnosticView.ts');
    files.push(...assets);
    const hash = createHash('sha256');
    for (const file of [...new Set(files)].sort()) hash.update(file).update('\0').update(readFileSync(file)).update('\0');
    return hash.digest('hex').slice(0, 16);
  };
  return {
    ...(product !== 'bot' ? {
      __W8RLD_EXTENSION_VERSION__: JSON.stringify(JSON.parse(readFileSync('extensions/roblox-limited-trading/manifest.json', 'utf8')).version),
      __W8RLD_EXTENSION_BUILD__: JSON.stringify(`w8rld-ext-${digest(['extensions/roblox-limited-trading/src'], ['extensions/roblox-limited-trading/manifest.json', 'extensions/roblox-limited-trading/options.html', 'extensions/roblox-limited-trading/overlay.css', 'extensions/roblox-limited-trading/THIRD_PARTY_NOTICES.txt', 'plugins/lib/robloxLimitedValuation.ts', 'plugins/lib/w8rldData.ts', 'plugins/lib/calculatorCore.ts', 'plugins/lib/historicalTrade.ts', 'plugins/lib/historicalTradeView.ts', 'plugins/lib/displayPrecision.ts'])}`),
    } : {}),
    ...(product !== 'extension' ? {
      __W8RLD_BOT_VERSION__: JSON.stringify(JSON.parse(readFileSync('package.json', 'utf8')).version),
      __W8RLD_BOT_BUILD__: JSON.stringify(`w8rld-bot-${digest(['plugins/discord/bot', 'plugins/lib'], ['mod/renderer/uiPalette.ts', 'plugins/discord/bot/authority/schema.sql', 'scripts/discord-bot-owner.mjs', 'scripts/discord-bot-supervisor.mjs', 'scripts/discord-bot-client-lifecycle.mjs', 'scripts/discord-bot-owner-state.mjs', 'scripts/discord-bot-local.mjs', 'scripts/discord-bot-windows.mjs', 'scripts/discord-bot-build.mjs'])}`),
    } : {}),
  };
}
