// SPDX-FileCopyrightText: 2026 Towk project contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";

import {
  checkCallDeploymentConfig,
  findCallDeploymentViolations,
} from "./check-call-deployment-config.mjs";

function deploymentFiles(checkedInConfig) {
  return {
    checkedInConfig,
    compose: [
      '"50000-50200:50000-50200/udp"',
      '"50201-50400:50201-50400/udp"',
      '"3478:3478/udp"',
      '"7881:7881/tcp"',
    ].join("\n"),
    generator: `  port_range_start: 50000
  port_range_end: 50200
  relay_range_start: 50201
  relay_range_end: 50400
`,
    exampleReadme:
      "50000-50200 50201-50400 use_external_ip allow_restricted_peer_cidrs",
    deploymentGuide:
      "50000-50200 50201-50400 use_external_ip allow_restricted_peer_cidrs",
    callGuide:
      "50000-50200 50201-50400 use_external_ip allow_restricted_peer_cidrs",
  };
}

test("the checked-in call deployment keeps direct media and TURN relay ranges aligned", async () => {
  assert.deepEqual(await checkCallDeploymentConfig(), []);
});

test("rejects an unpublished or overlapping TURN relay range", () => {
  const files = {
    checkedInConfig: `rtc:
  port_range_start: 50000
  port_range_end: 50200
turn:
  relay_range_start: 50200
  relay_range_end: 50400
`,
    compose: '"50000-50200:50000-50200/udp"\n"3478:3478/udp"\n"7881:7881/tcp"',
    generator: `  port_range_start: 50000
  port_range_end: 50200
  relay_range_start: 50200
  relay_range_end: 50400
`,
    exampleReadme:
      "50000-50200 50200-50400 use_external_ip allow_restricted_peer_cidrs",
    deploymentGuide:
      "50000-50200 50200-50400 use_external_ip allow_restricted_peer_cidrs",
    callGuide:
      "50000-50200 50200-50400 use_external_ip allow_restricted_peer_cidrs",
  };

  assert.deepEqual(findCallDeploymentViolations(files), [
    "livekit.yaml: direct media and TURN relay ranges must not overlap",
    "compose.yml: missing one-to-one LiveKit mapping 50200-50400:50200-50400/udp",
  ]);
});

test("rejects embedded TURN relaying to a private media node without permission", () => {
  const files = deploymentFiles(`rtc:
  port_range_start: 50000
  port_range_end: 50200
  use_external_ip: false
  node_ip: 10.0.0.10
turn:
  enabled: true
  udp_port: 3478
  relay_range_start: 50201
  relay_range_end: 50400
`);

  assert.deepEqual(findCallDeploymentViolations(files), [
    "livekit.yaml: embedded TURN must allow only the private media node 10.0.0.10/32",
  ]);
});

test("accepts embedded TURN with an exact private media-node permission", () => {
  const files = deploymentFiles(`rtc:
  port_range_start: 50000
  port_range_end: 50200
  use_external_ip: false
  node_ip: 10.0.0.10
turn:
  enabled: true
  udp_port: 3478
  relay_range_start: 50201
  relay_range_end: 50400
  allow_restricted_peer_cidrs:
    - 10.0.0.10/32
`);

  assert.deepEqual(findCallDeploymentViolations(files), []);
});

test("rejects a broad private TURN peer permission in the single-node example", () => {
  const files = deploymentFiles(`rtc:
  port_range_start: 50000
  port_range_end: 50200
  use_external_ip: false
  node_ip: 10.0.0.10
turn:
  enabled: true
  udp_port: 3478
  relay_range_start: 50201
  relay_range_end: 50400
  allow_restricted_peer_cidrs:
    - 192.168.0.0/16
`);

  assert.deepEqual(findCallDeploymentViolations(files), [
    "livekit.yaml: embedded TURN must allow only the private media node 10.0.0.10/32",
  ]);
});

test("does not require a restricted-peer permission when external IP discovery wins", () => {
  const files = deploymentFiles(`rtc:
  port_range_start: 50000
  port_range_end: 50200
  use_external_ip: true
  node_ip: 10.0.0.10
turn:
  enabled: true
  udp_port: 3478
  relay_range_start: 50201
  relay_range_end: 50400
`);

  assert.deepEqual(findCallDeploymentViolations(files), []);
});

test("requires a literal node IP when external discovery is disabled", () => {
  const files = deploymentFiles(`rtc:
  port_range_start: 50000
  port_range_end: 50200
  use_external_ip: false
turn:
  enabled: true
  udp_port: 3478
  relay_range_start: 50201
  relay_range_end: 50400
`);

  assert.deepEqual(findCallDeploymentViolations(files), [
    "livekit.yaml: embedded TURN with use_external_ip false must declare a literal rtc.node_ip",
  ]);
});

test("accepts an exact IPv6 media-node permission", () => {
  const files = deploymentFiles(`rtc:
  port_range_start: 50000
  port_range_end: 50200
  use_external_ip: false
  node_ip: fd00::46
turn:
  enabled: true
  udp_port: 3478
  relay_range_start: 50201
  relay_range_end: 50400
  allow_restricted_peer_cidrs: [fd00::46/128]
`);

  assert.deepEqual(findCallDeploymentViolations(files), []);
});

test("checks the generated LiveKit configuration as well as the hand-written example", () => {
  const files = deploymentFiles(`rtc:
  port_range_start: 50000
  port_range_end: 50200
  use_external_ip: true
turn:
  enabled: true
  udp_port: 3478
  relay_range_start: 50201
  relay_range_end: 50400
`);
  files.generator = `rtc:
  port_range_start: 50000
  port_range_end: 50200
  use_external_ip: false
  node_ip: 10.0.0.8
turn:
  enabled: true
  relay_range_start: 50201
  relay_range_end: 50400
`;

  assert.deepEqual(findCallDeploymentViolations(files), [
    "init-env.sh: embedded TURN must allow only the private media node 10.0.0.8/32",
  ]);
});
