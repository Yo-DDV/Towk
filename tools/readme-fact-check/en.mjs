import { BASELINE_SHA } from "./core.mjs";

export default {
  file: "README.md",
  summary: "How these metrics are produced",
  contributorAlt: "Towk commit and merged pull request authors since the public standalone foundation",
  body: `  The repository generates these SVGs from GitHub's API with its scoped
  \`GITHUB_TOKEN\`; it does not use a personal token or an external statistics
  service. The workflow refreshes after every push to \`main\` and is scheduled at
  approximately **06:17 and 21:17 Europe/Paris** each day.

  The headline counters and contributor rankings begin after the public
  standalone-foundation merge commit \`${BASELINE_SHA}\` from 12 July 2026. This
  prevents inherited Chatto history from being presented as current Towk progress.
  The charts retain rolling views of 30 days, 12 weeks and 12 months; periods before
  that foundation point appear as zero. Commits are selected topologically from
  \`main\` after the foundation commit and bucketed by their committed timestamp in
  UTC. Pull requests are counted by \`merged_at\` after the foundation timestamp.
  Rankings use the GitHub login when available and otherwise the public commit
  author name. Detected bots are excluded from human rankings and reported
  separately. These figures describe repository activity and Git attribution, not
  individual effort. Raw commit messages and email addresses are not written to the
  generated branch.

  The generated SVGs and machine-readable snapshot live on the
  [\`readme-metrics\`](https://github.com/Yo-DDV/Towk/tree/readme-metrics) branch.`,
  replacements: [
    [
      `> Towk is under active development and has not reached 1.0. For important
> deployments, pin an immutable release or image digest, keep tested backups,
> and review release notes before upgrading.`,
      `> Towk is under active development and has not reached 1.0. For important
> deployments, pin the exact image digest or source commit, keep tested backups,
> and review release notes and configuration changes before upgrading.`
    ],
    [
      `<p>Optional LiveKit voice/video rooms, screen sharing and call-media E2EE, plus an installable responsive PWA.</p>`,
      `<p>Optional LiveKit-powered voice and video calls, screen sharing and call-media E2EE, plus an installable responsive PWA.</p>`
    ],
    [
      `<p>Password/email flows, OIDC and selected OAuth providers, encrypted drafts, outbox and recent timelines on supported browsers.</p>`,
      `<p>Password/email flows, OIDC and selected OAuth providers, encrypted drafts, outbox and recent room timelines on supported browsers.</p>`
    ],
    [
      `<td width="33%" valign="top"><h3>🏠 Deployment</h3><p>Run one independently operated server per organization or community, from a compact binary to a replicated deployment.</p></td>`,
      `<td width="33%" valign="top"><h3>🏠 Deployment</h3><p>Each deployment serves one organization or community, from a compact binary to a replicated topology.</p></td>`
    ],
    [
      `<td width="33%" valign="top"><h3>📦 Build traceability</h3><p>Public source, immutable coordinates, exact-commit OCI metadata, SBOMs, vulnerability scans and provenance attestations.</p></td>`,
      `<td width="33%" valign="top"><h3>📦 Build traceability</h3><p>Public source, exact-commit OCI metadata, image digests, SBOMs, vulnerability scans and provenance attestations.</p></td>`
    ],
    [
      `<td width="33%" valign="top"><h3>📈 Operational visibility</h3><p>Health/readiness endpoints, Prometheus-compatible metrics, diagnostics, an administrative event log and reproducible performance gates.</p></td>`,
      `<td width="33%" valign="top"><h3>📈 Operational visibility</h3><p>Health/readiness endpoints, Prometheus-compatible metrics, diagnostics, an administrative event log and a reproducible media-performance qualification protocol.</p></td>`
    ],
    [
      `> envelope. LiveKit call media supports E2EE when calls are enabled.`,
      `> envelope. LiveKit call media uses E2EE when calls are enabled, but Towk
> provisions the shared call key; a Towk operator able to access those keys remains
> inside the call trust boundary.`
    ],
    [
      `For durable deployments, use an immutable image tag and digest rather than a
floating tag.`,
      `For durable deployments, pin an exact image digest rather than relying on a
floating tag.`
    ]
  ],
  required: [
    "not** a federated protocol",
    "end-to-end encryption for text conversations",
    "operator able to access those keys remains",
    "standalone-foundation merge commit",
    "GitHub login when available",
    "repository activity and Git attribution, not"
  ]
};
