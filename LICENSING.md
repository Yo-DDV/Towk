# Licensing

Towk uses per-file SPDX license metadata following the
[REUSE](https://reuse.software/) specification. The canonical machine-readable
license boundary is in [REUSE.toml](REUSE.toml).

The default repository license is the GNU Affero General Public License version
3 or any later version (`AGPL-3.0-or-later`). This covers the Towk server,
CLI, and bundled server release artifacts unless a more specific license is
declared.

Apache-2.0 exceptions are reserved for frontend, integration, and documentation
surfaces where permissive reuse is intentional. These include the standalone
frontend source and image, public protocol/API definitions, generated
TypeScript API client/types, documentation, and deployment examples.

Full license texts are available in [LICENSE](LICENSE) and [LICENSES/](LICENSES/).

## Towk modifications

Towk modifications retain the license assigned to each file or path by the
repository's SPDX and REUSE metadata. New files use AGPL-3.0-or-later unless a
documented Apache-2.0 surface in `REUSE.toml` applies.

Contributors certify that they have the right to submit their work under the
applicable repository license. Contributions copied from incompatible sources,
including generated output whose training or source terms do not permit the
required license, are not accepted.

Towk remains an independent project based on Chatto. Attribution to Chatto and
ChattoCorp GmbH is preserved in the repository history and notices; it does not
imply endorsement or support.
