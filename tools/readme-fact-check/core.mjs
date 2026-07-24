export const BASELINE_SHA = "205e91fe1ae5e5c23420974f7e04cf82456eeab3";

function countOccurrences(content, needle) {
  return content.split(needle).length - 1;
}

export function replaceExactOrCurrent(content, from, to, label) {
  if (from === to) return content;
  const targetCount = countOccurrences(content, to);
  const sourceCount = countOccurrences(content, from);
  const sourceOccurrencesInsideTarget = countOccurrences(to, from);
  const staleSourceCount = sourceCount - targetCount * sourceOccurrencesInsideTarget;

  if (targetCount > 1) {
    throw new Error(`${label}: corrected text appears ${targetCount} times`);
  }
  if (targetCount === 1) {
    if (staleSourceCount === 0) return content;
    throw new Error(`${label}: corrected and stale text are both present`);
  }
  if (staleSourceCount === 1) return content.replace(from, to);
  if (staleSourceCount > 1) {
    throw new Error(`${label}: source text appears ${staleSourceCount} times`);
  }
  throw new Error(`${label}: neither source nor corrected text was found`);
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeWhitespace(value) {
  return String(value).replace(/\s+/g, " ").trim();
}

export function updateEdition(content, locale, edition) {
  const contributorPattern = new RegExp(
    `(<img src="https://raw\\.githubusercontent\\.com/Yo-DDV/Towk/readme-metrics/${locale}/contributors\\.svg" width="100%" alt=")[^"]+(" />)`
  );
  if (!contributorPattern.test(content)) {
    throw new Error(`${edition.file}: contributor image was not found`);
  }
  let updated = content.replace(contributorPattern, `$1${edition.contributorAlt}$2`);

  const detailsPattern = new RegExp(
    `<details>\\n  <summary><strong>${escapeRegex(edition.summary)}</strong></summary>[\\s\\S]*?\\n</details>`
  );
  const matches = updated.match(new RegExp(detailsPattern.source, "g")) ?? [];
  if (matches.length !== 1) {
    throw new Error(`${edition.file}: expected one metrics details block, found ${matches.length}`);
  }
  updated = updated.replace(
    detailsPattern,
    `<details>\n  <summary><strong>${edition.summary}</strong></summary>\n\n${edition.body}\n</details>`
  );

  for (const [index, [from, to]] of edition.replacements.entries()) {
    updated = replaceExactOrCurrent(updated, from, to, `${edition.file} replacement ${index + 1}`);
  }
  const normalizedUpdated = normalizeWhitespace(updated);
  for (const marker of edition.required) {
    if (!normalizedUpdated.includes(normalizeWhitespace(marker))) {
      throw new Error(`${edition.file}: required fact marker is missing: ${marker}`);
    }
  }
  return updated;
}
