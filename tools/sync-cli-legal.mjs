#!/usr/bin/env node

import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const embeddedDir = path.join(repoRoot, "cli/cmd/embedded");

await mkdir(embeddedDir, { recursive: true });
await Promise.all([
  copyFile(
    path.join(repoRoot, "LICENSES/AGPL-3.0-or-later.txt"),
    path.join(repoRoot, "cli/LICENSE"),
  ),
  copyFile(path.join(repoRoot, "NOTICE"), path.join(repoRoot, "cli/NOTICE")),
  copyFile(
    path.join(repoRoot, "LICENSES/AGPL-3.0-or-later.txt"),
    path.join(embeddedDir, "LICENSE"),
  ),
  copyFile(
    path.join(repoRoot, "LICENSES/Apache-2.0.txt"),
    path.join(embeddedDir, "Apache-2.0"),
  ),
  copyFile(path.join(repoRoot, "NOTICE"), path.join(embeddedDir, "NOTICE")),
]);
