import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const ROOT = process.cwd();
const READMES = {
  en: "README.md",
  fr: "README.fr.md",
  de: "README.de.md",
  es: "README.es.md",
  pt: "README.pt.md"
};
const ANCHORS = [
  "why-towk",
  "development-pulse",
  "capabilities",
  "architecture",
  "run-towk",
  "project"
];
const ASSETS = [
  "hero.svg",
  "hero-mobile.svg",
  "activity.svg",
  "activity-mobile.svg",
  "contributors.svg",
  "contributors-mobile.svg"
];
const BALANCED_TAGS = ["picture", "table", "tr", "td", "details"];

function occurrences(text, pattern) {
  return [...text.matchAll(pattern)].length;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

export function checkReadme(content, locale, filename) {
  assert(Buffer.byteLength(content, "utf8") < 100_000, `${filename}: README is unexpectedly large`);
  assert(!/javascript:/i.test(content), `${filename}: javascript URLs are forbidden`);
  assert(!/<script\b/i.test(content), `${filename}: script elements are forbidden`);
  assert(!/<iframe\b/i.test(content), `${filename}: iframe elements are forbidden`);

  for (const tag of BALANCED_TAGS) {
    const opened = occurrences(content, new RegExp(`<${tag}(?:\\s|>)`, "gi"));
    const closed = occurrences(content, new RegExp(`</${tag}>`, "gi"));
    assert(opened === closed, `${filename}: unbalanced <${tag}> tags (${opened} open, ${closed} closed)`);
  }

  const fenceCount = occurrences(content, /^```/gm);
  assert(fenceCount % 2 === 0, `${filename}: unbalanced Markdown code fences`);

  const ids = [...content.matchAll(/<a id="([a-z0-9-]+)"><\/a>/g)].map((match) => match[1]);
  assert(new Set(ids).size === ids.length, `${filename}: duplicate explicit anchor`);
  for (const anchor of ANCHORS) {
    assert(ids.includes(anchor), `${filename}: missing #${anchor} anchor`);
    assert(content.includes(`href="#${anchor}"`), `${filename}: navigation does not link to #${anchor}`);
  }

  const metricPrefix = `https://raw.githubusercontent.com/Yo-DDV/Towk/readme-metrics/${locale}/`;
  for (const asset of ASSETS) {
    assert(content.includes(`${metricPrefix}${asset}`), `${filename}: missing localized ${asset}`);
  }
  const metricReferences = occurrences(content, /https:\/\/raw\.githubusercontent\.com\/Yo-DDV\/Towk\/readme-metrics\/[a-z]{2}\/[a-z-]+\.svg/g);
  assert(metricReferences === ASSETS.length, `${filename}: expected ${ASSETS.length} metric image references, found ${metricReferences}`);

  const imageTags = [...content.matchAll(/<img\b[^>]*>/gi)].map((match) => match[0]);
  assert(imageTags.length >= 10, `${filename}: expected product and presentation imagery`);
  for (const image of imageTags) {
    assert(/\balt="[^"]+"/i.test(image), `${filename}: image without useful alt text: ${image.slice(0, 100)}`);
  }

  assert(content.includes(".github/workflows/refresh-readme-metrics.yml"), `${filename}: metrics workflow link is missing`);
  assert(content.includes("tree/readme-metrics"), `${filename}: generated branch methodology link is missing`);
  assert(content.includes("apps/docs-website/src/assets/towk_light.png"), `${filename}: product screenshot is missing`);
  assert(content.includes("```mermaid"), `${filename}: architecture diagram is missing`);

  for (const readme of Object.values(READMES)) {
    if (readme === filename) continue;
    assert(content.includes(`href="${readme}"`), `${filename}: language link to ${readme} is missing`);
  }
}

export async function main() {
  const checked = [];
  for (const [locale, filename] of Object.entries(READMES)) {
    const content = await readFile(path.join(ROOT, filename), "utf8");
    checkReadme(content, locale, filename);
    checked.push(filename);
  }
  process.stdout.write(`README presentation check passed: ${checked.join(", ")}\n`);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
