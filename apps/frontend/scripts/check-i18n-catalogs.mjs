import { readdirSync, readFileSync } from 'node:fs';

const messagesRoot = new URL('../messages/', import.meta.url);
const settings = JSON.parse(
  readFileSync(new URL('../project.inlang/settings.json', import.meta.url))
);
const baseLocale = settings.baseLocale;
const locales = settings.locales;

function catalogFiles(locale) {
  return readdirSync(new URL(`${locale}/`, messagesRoot))
    .filter((file) => file.endsWith('.json'))
    .sort();
}

function flatten(value, prefix = '', output = new Map()) {
  if (typeof value === 'string') {
    output.set(prefix, value);
    return output;
  }

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Unsupported catalog value at ${prefix || '<root>'}`);
  }

  for (const [key, child] of Object.entries(value)) {
    if (key === '$schema') continue;
    flatten(child, prefix ? `${prefix}.${key}` : key, output);
  }
  return output;
}

function placeholders(message) {
  return [...message.matchAll(/\{([^{}]+)\}/g)].map((match) => match[1]).sort();
}

const baseFiles = catalogFiles(baseLocale);
const failures = [];

for (const locale of locales) {
  const files = catalogFiles(locale);
  if (JSON.stringify(files) !== JSON.stringify(baseFiles)) {
    failures.push(`${locale}: catalog files differ from ${baseLocale}`);
    continue;
  }

  for (const file of baseFiles) {
    const baseMessages = flatten(
      JSON.parse(readFileSync(new URL(`${baseLocale}/${file}`, messagesRoot)))
    );
    const localizedMessages = flatten(
      JSON.parse(readFileSync(new URL(`${locale}/${file}`, messagesRoot)))
    );

    for (const [key, baseMessage] of baseMessages) {
      if (!localizedMessages.has(key)) {
        failures.push(`${locale}/${file}: missing ${key}`);
        continue;
      }

      const localizedMessage = localizedMessages.get(key);
      if (localizedMessage.trim() === '') {
        failures.push(`${locale}/${file}: empty ${key}`);
      }
      if (
        JSON.stringify(placeholders(localizedMessage)) !== JSON.stringify(placeholders(baseMessage))
      ) {
        failures.push(`${locale}/${file}: placeholders differ for ${key}`);
      }
    }

    for (const key of localizedMessages.keys()) {
      if (!baseMessages.has(key)) failures.push(`${locale}/${file}: unexpected ${key}`);
    }
  }
}

if (failures.length > 0) {
  console.error(failures.join('\n'));
  process.exitCode = 1;
} else {
  console.log(`Checked ${locales.length} complete locales across ${baseFiles.length} catalogs.`);
}
