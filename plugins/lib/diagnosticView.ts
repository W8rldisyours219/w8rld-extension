/** Shared extension/client support controls. Only validated contract data reaches DOM/clipboard. */
import { formatDiagnosticReport, INVALID_DIAGNOSTIC_TEXT } from './safeDiagnostics';

export function createDiagnosticView(options: {
  load(): Promise<unknown>;
  clear(): Promise<void>;
  buttonClass?: string;
  textClass?: string;
  copy?(text: string): Promise<void>;
}): HTMLElement & { dispose(): void } {
  const root = document.createElement('section'); root.className = 'w8rld-support-diagnostics';
  root.setAttribute('aria-label', 'Support & Diagnostics');
  const title = document.createElement('h2'); title.className = 'w8rld-section-title'; title.textContent = 'Support & Diagnostics';
  const intro = document.createElement('p'); intro.textContent = 'Having an issue? Copy a safe debug report to include with your bug report.';
  const actions = document.createElement('div'); actions.className = 'w8rld-row-actions';
  const status = document.createElement('p'); status.className = 'w8rld-desc'; status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  const details = document.createElement('textarea'); details.className = options.textClass ?? ''; details.readOnly = true; details.hidden = true; details.rows = 12;
  details.setAttribute('aria-label', 'Sanitized debug information'); details.spellcheck = false;
  let busy = false; let generation = 0; let disposed = false;
  let observer: MutationObserver | undefined;
  const buttons: HTMLButtonElement[] = [];
  const show = (text: string) => { details.value = text; details.hidden = false; };
  const cancel = () => {
    generation++; observer?.disconnect(); observer = undefined; busy = false;
    details.value = ''; details.hidden = true; status.textContent = '';
    buttons.forEach(b => { b.disabled = disposed; });
  };
  const run = async (task: (current: () => boolean) => Promise<void>) => {
    if (busy || disposed || !root.isConnected) return;
    const version = ++generation;
    const current = () => !disposed && version === generation && root.isConnected;
    busy = true; buttons.forEach(b => { b.disabled = true; });
    // Client callers remove their Settings subtree without an explicit unmount.
    // Observe only while work is pending; detached views retain no observer.
    observer = new MutationObserver(records => {
      if (!root.isConnected || records.some(r => [...r.removedNodes].some(n => n === root || n.contains(root)))) cancel();
    });
    observer.observe(root.ownerDocument, { childList: true, subtree: true });
    try { await task(current); } catch {
      if (current()) { details.value = ''; details.hidden = true; status.textContent = 'Safe diagnostics are unavailable. Try again.'; }
    } finally {
      if (version === generation) { observer?.disconnect(); observer = undefined; busy = false; buttons.forEach(b => { b.disabled = false; }); }
    }
  };
  const load = async () => {
    const text = formatDiagnosticReport(await options.load());
    if (text === INVALID_DIAGNOSTIC_TEXT) throw new Error('Invalid diagnostic data');
    return text;
  };
  const button = (label: string, action: (current: () => boolean) => Promise<void>) => {
    const b = document.createElement('button'); b.type = 'button'; b.className = options.buttonClass ?? ''; b.textContent = label;
    b.addEventListener('click', () => { void run(action); }); buttons.push(b); actions.append(b);
  };
  button('Copy Debug Info', async current => {
    const text = await load(); if (!current()) return;
    try {
      await (options.copy ? options.copy(text) : navigator.clipboard.writeText(text));
      if (current()) status.textContent = 'Debug information copied.';
    } catch {
      if (!current()) return;
      show(text); details.focus(); details.select(); status.textContent = 'Clipboard unavailable. Copy the selected sanitized text.';
    }
  });
  button('View Details', async current => { const text = await load(); if (!current()) return; show(text); status.textContent = details.value.includes('No recent errors recorded.') ? 'No recent errors recorded.' : 'Safe diagnostics shown.'; });
  button('Clear History', async current => {
    await options.clear(); if (!current()) return; details.value = ''; details.hidden = true; status.textContent = 'No recent errors recorded.';
  });
  root.append(title, intro, actions, status, details);
  return Object.assign(root, { dispose() { disposed = true; cancel(); } });
}
