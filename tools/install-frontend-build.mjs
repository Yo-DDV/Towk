#!/usr/bin/env node

import { cp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const frontendBuild = path.join(repoRoot, "apps/frontend/build");
const embeddedClient = path.join(repoRoot, "cli/internal/http_server/.client");

await writeFile(path.join(frontendBuild, ".mise-build-stamp"), "");
await rm(embeddedClient, { recursive: true, force: true });
await cp(frontendBuild, embeddedClient, { recursive: true });
await writeFile(path.join(embeddedClient, ".gitkeep"), "");
