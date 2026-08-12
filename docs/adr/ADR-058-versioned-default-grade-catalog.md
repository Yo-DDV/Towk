# ADR-058: Versioned Default Grade Catalog

**Date:** 2026-08-06

## Context

Towk's permission-only RBAC is deliberately flexible, but that flexibility makes first-time role configuration difficult. Owners need recognizable default grades and safe permission templates without turning display position into an authorization hierarchy or silently changing existing deployments when the permission catalog grows.

Adding Helper also introduces compatibility constraints:

- roles and user logins share the mention-handle namespace;
- role state is event-sourced;
- mixed-version clients and servers must not mistake a template request for ordinary empty role creation;
- boot-time defaults must not become an implicit privilege migration.

## Decision

Towk defines a versioned default grade catalog on top of the existing role domain.

The built-in identifiers are `owner`, `admin`, `moderator`, `helper` and `everyone`. Helper uses reserved display position 50. Position remains display metadata only; clients choose the principal display grade through explicit structural priority.

The immutable baselines are `members.v1`, `helper.v1`, `moderator.v1` and `admin.v2`. Templates contain only explicit server-scope decisions contributed by the grade. They do not duplicate `everyone` inheritance and do not create automatic denials.

Fresh RBAC state seeds the complete catalog. Upgraded state preserves every stored decision. Ordinary startup retains only previously supported historical backfills; it never injects newly recommended Moderator or Admin powers. Helper provisioning is idempotent when the role catalog is read. Existing roles named `helper` are preserved; a user-handle collision blocks Helper provisioning without blocking server startup.

The established protobuf role-creation message remains unchanged. The bundled client attaches a stable template command header understood by upgraded servers. The server validates the template and performs the complete baseline application before returning success. Older clients retain ordinary role creation, and older servers are not sent an unknown protobuf field that could be silently ignored.

Towk adds `message.delete-others` and `room.remove-member`. Each narrow permission forms a deny-wins semantic family with its broad legacy counterpart, preserving historical grants and denials while allowing a safer Moderator baseline.

Durable facts remain language-neutral. The frontend resolves grade and template text from the five supported locale catalogs under ADR-043.

## Consequences

- Owners receive safe defaults without losing granular RBAC.
- Helper is consistently represented across APIs and member presentation.
- Existing deployments do not gain privileges during restart.
- Role creation from a template is one observable server command for the bundled client.
- A shared handle collision can temporarily leave an upgraded deployment without Helper until an owner renames the conflicting account.
- Positions remain unsuitable for authorization.
- The command-header extension is an additive bundled-client contract and must remain documented while in use.

## Alternatives Rejected

### Treat Helper as an ordinary custom role

Rejected because the product requires a default grade with stable localized identity and lifecycle protections.

### Overwrite an existing `helper` role

Rejected because adopting the grade must preserve existing assignments and policy.

### Add recommendations during every boot

Rejected because clearing a default to `NONE` must remain durable and upgrades must not grant new power implicitly.

### Restore rank-based authorization

Rejected because ADR-040 deliberately separates display order from permission resolution.

## Related

- ADR-040: Permission-Only RBAC with Owner Override
- ADR-043: Client-Shell Internationalization
- FDR-001: Roles & Permissions
- FDR-033: Default Grades and Permission Templates
