# Towk coding instructions

Read `/AGENTS.md`, `/CONTRIBUTING.md`, and every path-specific `AGENTS.md` before
making changes. These tracked rules are mandatory for Copilot and all other
coding agents.

Towk is an independent product based on Chatto. Use Towk on current product
surfaces, but preserve inherited protocol namespaces, storage identifiers,
configuration aliases, and attribution according to ADR-049.

Keep changes small and reviewable, preserve license provenance, add meaningful
tests, and report exactly which checks ran. Never add secrets, personal data,
private prompts, transcripts, production logs, or machine-specific settings.
The person submitting the change remains accountable for the complete diff.
