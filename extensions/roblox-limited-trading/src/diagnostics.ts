/** Extension adapter: memory-only worker history and fixed internal event messages. */
import { coarseDiagnosticOS, createDiagnosticHistory, diagnosticRuntimeMajor, parseDiagnosticEvent, type DiagnosticEvent, type DiagnosticReport } from '../../../plugins/lib/safeDiagnostics';

declare const __W8RLD_EXTENSION_VERSION__: string;
declare const __W8RLD_EXTENSION_BUILD__: string;
export const extensionDiagnosticHistory = createDiagnosticHistory('extension');
export function extensionDiagnosticReport(enabled: boolean, providers?: DiagnosticReport['providers']): DiagnosticReport {
  const recent = extensionDiagnosticHistory.snapshot();
  return { schemaVersion: 1, product: 'extension', version: typeof __W8RLD_EXTENSION_VERSION__ === 'string' ? __W8RLD_EXTENSION_VERSION__ : 'unknown',
    build: typeof __W8RLD_EXTENSION_BUILD__ === 'string' ? __W8RLD_EXTENSION_BUILD__ : 'unknown',
    os: coarseDiagnosticOS(typeof navigator === 'undefined' ? '' : navigator.platform), runtime: 'Chrome',
    runtimeMajor: diagnosticRuntimeMajor(typeof navigator === 'undefined' ? undefined : /Chrome\/(\d+)/.exec(navigator.userAgent)?.[1]),
    current: !enabled ? {code:'W8RLD-EXT-SUPPORT-000',status:'disabled',enabled:'no'} : recent[recent.length-1] ?? {code:'W8RLD-EXT-SUPPORT-000',status:'ok',enabled:'yes'},
    recent, privacy: 'sanitized', ...(providers ? {providers} : {}) };
}
const CONTENT_CODES = new Set(['W8RLD-EXT-CONTENT-001', 'W8RLD-EXT-CONTENT-002', 'W8RLD-EXT-TRADE-001', 'W8RLD-EXT-PREVIEW-001', 'W8RLD-EXT-THUMBNAIL-001', 'W8RLD-EXT-NAVIGATION-001']);
let lastEmission = ''; let lastEmissionTime = 0;
export function parseContentDiagnostic(value: unknown): DiagnosticEvent | undefined {
  const event = parseDiagnosticEvent(value, 'extension');
  return event && CONTENT_CODES.has(event.code) ? event : undefined;
}
/** Never accepts a URL, exception, arbitrary context or page-provided object. */
export function emitContentDiagnostic(extension: any, event: DiagnosticEvent): void {
  try {
    const safe = parseContentDiagnostic(event); if (!safe) return;
    const signature = JSON.stringify(safe), time = Date.now();
    if (signature === lastEmission && time - lastEmissionTime < 1000) return;
    lastEmission = signature; lastEmissionTime = time;
    extension.runtime.sendMessage({ type: 'w8rld:diagnostic-event', event: safe }, () => { void extension.runtime.lastError; });
  } catch { /* Collection cannot interrupt the observed feature. */ }
}
