import sharp from 'sharp';
import { mkdir } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '../../..');
const outDir = join(__dirname, '../static/icons');
const sourcePath = join(repoRoot, 'branding/towk-mark.svg');
const installIconBackground = '#05050a';

const targets = [
  // Install-facing icons must be full-bleed and opaque so Safari/macOS does
  // not wrap a transparent, already-rounded icon in another app tile.
  { path: join(outDir, 'icon-192.png'), size: 192, flatten: true },
  { path: join(outDir, 'icon-512.png'), size: 512, flatten: true },
  { path: join(outDir, 'apple-touch-icon.png'), size: 180, flatten: true },
  { path: join(outDir, 'icon-maskable-192.png'), size: 192, flatten: true },
  { path: join(outDir, 'icon-maskable-512.png'), size: 512, flatten: true },
  // Browser tab favicon keeps the smaller rounded composition.
  { path: join(outDir, 'favicon.png'), size: 32, flatten: false },
  { path: join(repoRoot, 'favicon.png'), size: 32, flatten: false },
  {
    path: join(repoRoot, 'apps/docs-website/src/assets/opengraph-logo.png'),
    size: 256,
    flatten: false
  }
];

async function main() {
  await mkdir(outDir, { recursive: true });

  for (const { path, size, flatten } of targets) {
    await mkdir(dirname(path), { recursive: true });
    let image = sharp(sourcePath).resize(size, size);
    if (flatten) image = image.flatten({ background: installIconBackground });
    await image.png().toFile(path);
    console.log(
      `Generated ${path.slice(repoRoot.length + 1)} (${size}x${size}) from branding/towk-mark.svg`
    );
  }
}

main().catch(console.error);
