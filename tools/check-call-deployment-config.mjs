#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 Towk project contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFile } from "node:fs/promises";
import { isIP } from "node:net";
import path from "node:path";
import { pathToFileURL } from "node:url";

const files = {
  compose: "examples/dockercompose/compose.yml",
  checkedInConfig: "examples/dockercompose/livekit.yaml",
  generator: "examples/dockercompose/init-env.sh",
  exampleReadme: "examples/dockercompose/README.md",
  deploymentGuide:
    "apps/docs-website/src/content/docs/guides/deployment/docker-compose.mdx",
  callGuide:
    "apps/docs-website/src/content/docs/guides/infrastructure/voice-calls.mdx",
};

function yamlSectionLines(contents, section) {
  const lines = contents.split("\n");
  const start = lines.findIndex((line) =>
    new RegExp(`^${section}:\\s*(?:#.*)?$`).test(line),
  );
  if (start === -1) return [];

  const block = [];
  for (const line of lines.slice(start + 1)) {
    if (/^[^\s#]/.test(line)) break;
    block.push(line);
  }
  return block;
}

function unquoteYamlScalar(value) {
  const trimmed = value.trim();
  if (
    trimmed.length >= 2 &&
    ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'")))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function yamlScalar(contents, section, key) {
  for (const line of yamlSectionLines(contents, section)) {
    const match = line.match(
      new RegExp(`^[ \\t]+${key}:\\s*([^#]*?)\\s*(?:#.*)?$`),
    );
    if (match) return unquoteYamlScalar(match[1]);
  }
  return null;
}

function yamlNumber(contents, section, key) {
  const value = yamlScalar(contents, section, key);
  return value !== null && /^\d+$/.test(value) ? Number(value) : null;
}

function yamlBoolean(contents, section, key) {
  const value = yamlScalar(contents, section, key);
  if (value === "true") return true;
  if (value === "false") return false;
  return null;
}

function yamlStringList(contents, section, key) {
  const lines = yamlSectionLines(contents, section);
  const keyIndex = lines.findIndex((line) =>
    new RegExp(`^[ \\t]+${key}:`).test(line),
  );
  if (keyIndex === -1) return [];

  const keyLine = lines[keyIndex];
  const inlineValue = keyLine
    .slice(keyLine.indexOf(":") + 1)
    .replace(/\s+#.*$/, "")
    .trim();
  if (inlineValue.startsWith("[") && inlineValue.endsWith("]")) {
    return inlineValue
      .slice(1, -1)
      .split(",")
      .map(unquoteYamlScalar)
      .filter(Boolean);
  }
  if (inlineValue !== "") return [unquoteYamlScalar(inlineValue)];

  const keyIndent = keyLine.match(/^[ \\t]*/)?.[0].length ?? 0;
  const values = [];
  for (const line of lines.slice(keyIndex + 1)) {
    if (line.trim() === "" || /^\s*#/.test(line)) continue;
    const indent = line.match(/^[ \\t]*/)?.[0].length ?? 0;
    if (indent <= keyIndent) break;
    const value = line.match(/^\s*-\s*([^#]*?)\s*(?:#.*)?$/)?.[1];
    if (value !== undefined) values.push(unquoteYamlScalar(value));
  }
  return values;
}

function isRestrictedAddress(address) {
  const version = isIP(address);
  if (version === 4) {
    const [first, second] = address.split(".").map(Number);
    return (
      first === 0 ||
      first === 10 ||
      first === 127 ||
      (first === 169 && second === 254) ||
      (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && second === 168) ||
      first >= 224
    );
  }
  if (version === 6) {
    const normalized = address.toLowerCase();
    return (
      normalized === "::" ||
      normalized === "::1" ||
      /^f[cd]/.test(normalized) ||
      /^fe[89ab]/.test(normalized) ||
      normalized.startsWith("ff")
    );
  }
  return false;
}

function privateTurnViolations(contents, name) {
  if (
    yamlBoolean(contents, "turn", "enabled") !== true ||
    yamlBoolean(contents, "rtc", "use_external_ip") !== false
  ) {
    return [];
  }

  const nodeIp = yamlScalar(contents, "rtc", "node_ip");
  if (nodeIp === null || isIP(nodeIp) === 0) {
    return [
      `${name}: embedded TURN with use_external_ip false must declare a literal rtc.node_ip`,
    ];
  }
  if (!isRestrictedAddress(nodeIp)) return [];

  const hostPrefix = isIP(nodeIp) === 4 ? 32 : 128;
  const expectedCidr = `${nodeIp}/${hostPrefix}`;
  const allowedCidrs = yamlStringList(
    contents,
    "turn",
    "allow_restricted_peer_cidrs",
  );
  return allowedCidrs.length === 1 && allowedCidrs[0] === expectedCidr
    ? []
    : [
        `${name}: embedded TURN must allow only the private media node ${expectedCidr}`,
      ];
}

export function findCallDeploymentViolations(contents) {
  const violations = [];
  const rtcStart = yamlNumber(
    contents.checkedInConfig,
    "rtc",
    "port_range_start",
  );
  const rtcEnd = yamlNumber(contents.checkedInConfig, "rtc", "port_range_end");
  const relayStart = yamlNumber(
    contents.checkedInConfig,
    "turn",
    "relay_range_start",
  );
  const relayEnd = yamlNumber(
    contents.checkedInConfig,
    "turn",
    "relay_range_end",
  );

  violations.push(
    ...privateTurnViolations(contents.checkedInConfig, "livekit.yaml"),
    ...privateTurnViolations(contents.generator, "init-env.sh"),
  );

  if (
    [rtcStart, rtcEnd, relayStart, relayEnd].some((value) => value === null)
  ) {
    violations.push(
      "livekit.yaml: direct and TURN relay ranges must be explicit",
    );
    return violations;
  }
  if (rtcStart > rtcEnd || relayStart > relayEnd) {
    violations.push("livekit.yaml: media port ranges must be ordered");
  }
  if (rtcEnd >= relayStart && relayEnd >= rtcStart) {
    violations.push(
      "livekit.yaml: direct media and TURN relay ranges must not overlap",
    );
  }

  const requiredMappings = [
    `${rtcStart}-${rtcEnd}:${rtcStart}-${rtcEnd}/udp`,
    `${relayStart}-${relayEnd}:${relayStart}-${relayEnd}/udp`,
    "3478:3478/udp",
    "7881:7881/tcp",
  ];
  for (const mapping of requiredMappings) {
    if (!contents.compose.includes(`"${mapping}"`)) {
      violations.push(
        `compose.yml: missing one-to-one LiveKit mapping ${mapping}`,
      );
    }
  }

  for (const [key, expected] of [
    ["port_range_start", rtcStart],
    ["port_range_end", rtcEnd],
    ["relay_range_start", relayStart],
    ["relay_range_end", relayEnd],
  ]) {
    if (
      !new RegExp(`^[ \\t]+${key}:\\s*${expected}\\s*$`, "m").test(
        contents.generator,
      )
    ) {
      violations.push(
        `init-env.sh: generated LiveKit ${key} must remain ${expected}`,
      );
    }
  }

  const directRange = `${rtcStart}-${rtcEnd}`;
  const relayRange = `${relayStart}-${relayEnd}`;
  for (const [name, document] of [
    ["README.md", contents.exampleReadme],
    ["Docker Compose guide", contents.deploymentGuide],
    ["call infrastructure guide", contents.callGuide],
  ]) {
    if (!document.includes(directRange) || !document.includes(relayRange)) {
      violations.push(
        `${name}: direct and TURN relay ranges must both be documented`,
      );
    }
    if (
      !document.includes("use_external_ip") ||
      !document.includes("allow_restricted_peer_cidrs")
    ) {
      violations.push(
        `${name}: private-node embedded TURN permission must be documented`,
      );
    }
  }

  return violations;
}

export async function checkCallDeploymentConfig(root = process.cwd()) {
  return findCallDeploymentViolations(
    Object.fromEntries(
      await Promise.all(
        Object.entries(files).map(async ([key, relativePath]) => [
          key,
          await readFile(path.join(root, relativePath), "utf8"),
        ]),
      ),
    ),
  );
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const violations = await checkCallDeploymentConfig();
  if (violations.length > 0) {
    for (const violation of violations) console.error(violation);
    process.exitCode = 1;
  } else {
    console.log("Call deployment configuration is aligned.");
  }
}
