/** Shared, market-neutral calculator result assembly. Market adapters own lookup
 * and units; terminal and workspace consumers render this one result. */
export type CalculatorMarket = 'adopt-me' | 'mm2' | 'roblox-limiteds';

export interface CalculatorMetric {
  key: string;
  label: string;
  value: number;
}

export interface CalculatorEntry {
  name: string;
  quantity: number;
  metrics?: CalculatorMetric[];
  warning?: string;
}

export interface CalculatorSide {
  entries: CalculatorEntry[];
  totals: CalculatorMetric[];
  missingValues: string[];
}

export interface CalculatorResult {
  market: CalculatorMarket;
  give: CalculatorSide;
  get: CalculatorSide;
  differences: CalculatorMetric[];
  warnings: string[];
}

/** Shared quantity arithmetic. Callers retain their existing admission/overflow policies. */
export function quantityWeightedSum(total: number, unitValue: number, quantity: number): number {
  return total + unitValue * quantity;
}

export function calculateTrade(market: CalculatorMarket, give: CalculatorEntry[], get: CalculatorEntry[]): CalculatorResult {
  const side = (entries: CalculatorEntry[]): CalculatorSide => {
    const totals = new Map<string, CalculatorMetric>();
    const missingValues: string[] = [];
    for (const entry of entries) {
      if (!Number.isInteger(entry.quantity) || entry.quantity <= 0) {
        missingValues.push(`${entry.name} (invalid quantity)`);
        continue;
      }
      if (!entry.metrics?.length) {
        missingValues.push(entry.name);
        continue;
      }
      for (const metric of entry.metrics) {
        const existing = totals.get(metric.key) ?? { ...metric, value: 0 };
        existing.value = quantityWeightedSum(existing.value, metric.value, entry.quantity);
        totals.set(metric.key, existing);
      }
    }
    return { entries, totals: [...totals.values()], missingValues };
  };
  const left = side(give);
  const right = side(get);
  const rightByKey = new Map(right.totals.map((metric) => [metric.key, metric]));
  const differences = left.totals.map((metric) => ({ ...metric, value: (rightByKey.get(metric.key)?.value ?? 0) - metric.value }));
  const warnings = [...left.missingValues, ...right.missingValues].length ? ['A total excludes one or more items with no current value.'] : [];
  return { market, give: left, get: right, differences, warnings };
}

/** Parses a deliberately small calculator entry format: `2x Item, Item`. */
export function parseCalculatorEntries(raw: string): { quantity: number; query: string }[] {
  if (!raw.trim()) return [];
  return raw.split(/[,\n]+/).map((part) => {
    const match = /^\s*(?:(\d+)\s*(?:x|\*)\s*)?(.+?)\s*$/i.exec(part);
    return { quantity: Number(match?.[1] ?? 1), query: match?.[2]?.trim() ?? '' };
  }).filter((entry) => entry.query.length > 0);
}
