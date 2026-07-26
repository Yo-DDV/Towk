import { EDITIONS as ACTIVITY_EDITIONS, updateEdition as updateActivityEdition } from "../update-readme-project-pulse-copy.mjs";

export const BASELINE_SHA = "205e91fe1ae5e5c23420974f7e04cf82456eeab3";

function countOccurrences(content, needle) { return content.split(needle).length - 1; }
export function replaceExactOrCurrent(content, from, to, label) {
  if (from === to) return content;
  const targetCount = countOccurrences(content, to), sourceCount = countOccurrences(content, from), sourceInsideTarget = countOccurrences(to, from);
  const staleSourceCount = sourceCount - targetCount * sourceInsideTarget;
  if (targetCount > 1) throw new Error(`${label}: corrected text appears ${targetCount} times`);
  if (targetCount === 1) { if (staleSourceCount === 0) return content; throw new Error(`${label}: corrected and stale text are both present`); }
  if (staleSourceCount === 1) return content.replace(from, to);
  if (staleSourceCount > 1) throw new Error(`${label}: source text appears ${staleSourceCount} times`);
  throw new Error(`${label}: neither source nor corrected text was found`);
}
function normalizeWhitespace(value) { return String(value).replace(/\s+/g, " ").trim(); }

export function updateEdition(content, locale, edition) {
  const activityEdition = ACTIVITY_EDITIONS[locale];
  if (!activityEdition) throw new Error(`Unknown README activity locale: ${locale}`);
  let updated = updateActivityEdition(content, locale, activityEdition);
  for (const [index, [from, to]] of edition.replacements.entries()) {
    updated = replaceExactOrCurrent(updated, from, to, `${edition.file} replacement ${index + 1}`);
  }

  // Legacy locale modules still contain the superseded metrics paragraph only so
  // older branches can import them. Markers that occur inside that paragraph are
  // now owned and validated by the dedicated repository-activity updater above.
  const legacyMetricsBody = normalizeWhitespace(edition.body ?? "");
  const normalizedUpdated = normalizeWhitespace(updated);
  for (const marker of edition.required) {
    const normalizedMarker = normalizeWhitespace(marker);
    if (legacyMetricsBody.includes(normalizedMarker)) continue;
    if (!normalizedUpdated.includes(normalizedMarker)) throw new Error(`${edition.file}: required fact marker is missing: ${marker}`);
  }
  return updated;
}
