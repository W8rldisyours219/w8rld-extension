/** Rolimon's array schema already used by W8RLD. Live access remains gated. */
import { parseCatalogText } from '../core';
import { rolimonsMetricEvidence } from '../marketEvidence';

export { ROLIMONS_ENDPOINT } from '../../../../plugins/lib/robloxLimitedValuation';
export function parseRolimonsObservations(text: string, retrievedAt: number, now = retrievedAt) {
  return new Map([...parseCatalogText(text, retrievedAt)].map(([id, quote]) => [id, {
    quote, metrics: rolimonsMetricEvidence(quote, now),
  }]));
}
