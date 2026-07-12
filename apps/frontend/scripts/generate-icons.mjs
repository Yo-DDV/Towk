import sharp from 'sharp';
import { copyFile, mkdir } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '../../..');
const outDir = join(__dirname, '../static/icons');
const brandingDir = join(repoRoot, 'branding');

const targets = [
  {
    source: 'towk-app-icon-192.png',
    path: join(outDir, 'icon-192.png'),
    size: 192
  },
  {
    source: 'towk-app-icon-512.png',
    path: join(outDir, 'icon-512.png'),
    size: 512
  },
  {
    source: 'towk-apple-touch-icon.png',
    path: join(outDir, 'apple-touch-icon.png'),
    size: 180
  },
  {
    source: 'towk-maskable-icon-512.png',
    path: join(outDir, 'icon-maskable-192.png'),
    size: 192
  },
  {
    source: 'towk-maskable-icon-512.png',
    path: join(outDir, 'icon-maskable-512.png'),
    size: 512
  },
  {
    source: 'towk-favicon-32.png',
    path: join(outDir, 'favicon.png'),
    size: 32
  },
  {
    source: 'towk-favicon-32.png',
    path: join(repoRoot, 'favicon.png'),
    size: 32
  },
  {
    source: 'towk-symbol-256.png',
    path: join(outDir, 'symbol-256.png'),
    size: 256
  },
  {
    source: 'towk-symbol-256.png',
    path: join(repoRoot, 'apps/docs-website/src/assets/towk-symbol.png'),
    size: 256
  }
];

const directCopies = [
  {
    source: 'towk-favicon.ico',
    path: join(repoRoot, 'apps/docs-website/public/favicon.ico')
  },
  {
    source: 'towk-apple-touch-icon.png',
    path: join(repoRoot, 'apps/docs-website/public/apple-touch-icon.png')
  }
];

async function main() {
  await mkdir(outDir, { recursive: true });

  for (const { source, path, size } of targets) {
    await mkdir(dirname(path), { recursive: true });
    const sourcePath = join(brandingDir, source);
    const metadata = await sharp(sourcePath).metadata();

    if (metadata.width === size && metadata.height === size) {
      await copyFile(sourcePath, path);
    } else {
      await sharp(sourcePath).resize(size, size).png().toFile(path);
    }

    console.log(
      `Generated ${path.slice(repoRoot.length + 1)} (${size}x${size}) from branding/${source}`
    );
  }

  for (const { source, path } of directCopies) {
    await mkdir(dirname(path), { recursive: true });
    await copyFile(join(brandingDir, source), path);
    console.log(`Copied ${path.slice(repoRoot.length + 1)} from branding/${source}`);
  }
}

main().catch(console.error);
