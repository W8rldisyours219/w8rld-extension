/** Similar Price admits only genuine, current Routility USD observations.
 * RAP, curated Value and display conversion preferences never affect ranking. */
import { QUOTE_FRESH_MS, safeAssetId } from './core';
import type { MetricObservation } from './marketEvidence';

export function comparableUsd(q: MetricObservation<number> | undefined, assetId: string, now = Date.now()): number | undefined {
  return q?.assetId === assetId && safeAssetId(assetId) === assetId && q.provider === 'routility' && q.unit === 'USD'
    && q.availability === 'available' && q.validation === 'validated' && q.coverage === 'complete' && q.freshness === 'fresh'
    && Number.isSafeInteger(q.retrievedAt) && q.retrievedAt > 0 && q.retrievedAt <= now && now - q.retrievedAt < QUOTE_FRESH_MS
    && typeof q.value === 'number' && Number.isFinite(q.value) && q.value >= 0 && q.value <= Number.MAX_SAFE_INTEGER ? q.value : undefined;
}

export function usdDistance(current: MetricObservation<number> | undefined, candidate: MetricObservation<number>, now = Date.now()) {
  if (!current || current.assetId === candidate.assetId) return;
  const target = comparableUsd(current, current.assetId, now), value = comparableUsd(candidate, candidate.assetId, now);
  if (target === undefined || target <= 0 || value === undefined) return;
  const absoluteDifference = Math.abs(value - target);
  return { absoluteDifference, percentageDifference: absoluteDifference / target * 100 };
}
