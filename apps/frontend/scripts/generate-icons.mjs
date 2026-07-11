import sharp from 'sharp';
import { mkdir } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, '../static/icons');
const sourcePath = join(__dirname, '../../../branding/towk-mark.svg');
const installIconBackground = '#0b1020';

const sizes = [
  // Install-facing icons must be full-bleed and opaque so Safari/macOS does
  // not wrap a transparent, already-rounded icon in another app tile.
  { name: 'icon-192.png', size: 192, flatten: true },
  { name: 'icon-512.png', size: 512, flatten: true },
  { name: 'apple-touch-icon.png', size: 180, flatten: true },
  { name: 'icon-maskable-192.png', size: 192, flatten: true },
  { name: 'icon-maskable-512.png', size: 512, flatten: true },
  // Browser tab favicon keeps the smaller rounded composition.
  { name: 'favicon.png', size: 32, flatten: false }
];

async function main() {
  await mkdir(outDir, { recursive: true });

  for (const { name, size, flatten } of sizes) {
    let image = sharp(sourcePath).resize(size, size);
    if (flatten) image = image.flatten({ background: installIconBackground });
    await image.png().toFile(join(outDir, name));
    console.log(`Generated ${name} (${size}x${size}) from branding/towk-mark.svg`);
  }
}

main().catch(console.error);
