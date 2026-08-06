# ADR-057: Versioned Default Grade Catalog

**Date:** 2026-08-06

## Context

Towk's permission-only RBAC is deliberately flexible, but that flexibility makes first-time role configuration difficult. Owners need recognizable default grades and safe permission templates without turning display position into an authorization hierarchy or silently changing existing deployments when the permission catalog grows.

Adding Helper also introduces compatibility constraints:

- roles and user logins share the mention-handle namespace;
- role state is event-sourced;
- old role events contain no explicit system-kind enum;
- mixed-version clients and servers must not mistake a template request for an ordinary empty role creation;
- boot-time defaults must not become an implicit privilege migration.

## Decision

Towk defines a versioned default grade catalog on top of the existing role domain.

### Stable grades

The built-in identifiers are:

- `owner`;
- `admin`;
- `moderator`;
- `helper`;
- `everyone`.

Helper is recognized as a system grade and uses reserved display position 50. Position remains display metadata only. Product clients choose the principal display grade through explicit structural priority rather than using position as authorization rank.

### Versioned templates

The canonical baselines are immutable records identified as `members.v1`, `helper.v1`, `moderator.v1` and `admin.v2`. Templates contain only explicit server-scope decisions contributed by that grade. They do not duplicate permissions inherited from `everyone` and they do not write automatic denies.

`DefaultAdminPermissions` is an explicit list. Future catalog additions require an explicit template decision and cannot automatically expand Admin.

### Fresh state versus upgrades

Fresh RBAC state seeds the complete catalog, including Helper and the current baselines.

Upgraded state preserves every stored decision. Ordinary startup retains only previously supported historical backfills; it never injects newly recommended Moderator or Admin powers. Helper provisioning is idempotent and is completed when the catalog is read. Existing `helper` roles are preserved. Existing user-handle collisions block only Helper provisioning and do not block server startup.

### Template command compatibility

The existing protobuf role-creation request remains unchanged. The bundled client attaches a stable template command header understood only by upgraded servers. The handler validates that header and applies the template server-side. Older clients keep using ordinary role creation, and older servers do not receive a protobuf field they might silently ignore.

Template application uses server-side compensation: a role is not returned as successful until all baseline decisions are persisted and readable; failure removes the newly created role before returning an error. A future event-level policy replacement may strengthen this boundary without changing the user-facing contract.

### Narrow permission families

Towk adds `message.delete-others` and `room.remove-member`. Each narrow permission forms a deny-wins semantic family with its broad legacy counterpart. This preserves old grants and denials while allowing safe new Moderator templates.

### Localization

Durable facts remain language-neutral. The frontend resolves system-grade and template text from five version-controlled locale catalogs, following ADR-043.

## Consequences

- Owners receive safe defaults without losing granular RBAC.
- Helper is consistently represented across APIs and member presentation.
- Existing deployments do not gain privileges during restart.
- Role creation from a template is one observable server command for the bundled client.
- A shared handle collision can temporarily leave an upgraded deployment without Helper until an owner renames the conflicting account.
- Positions remain unsuitable for actor-versus-target authorization.
- The temporary command-header extension must be documented and retained while clients rely on it.

## Alternatives Rejected

### Treat Helper as an ordinary custom role

Rejected because the product requires a default grade with stable localized identity and lifecycle protections.

### Infer every role named `helper` as newly safe

Rejected as a permission migration. Existing policy is preserved and displayed rather than overwritten.

### Add new recommended permissions during every boot

Rejected because clearing a default to `NONE` must remain durable and upgrades must not grant new power implicitly.

### Restore role-rank authorization

Rejected because ADR-040 intentionally separates display order from permission resolution.

## Related

- ADR-040: Permission-Only RBAC with Owner Override
- ADR-043: Client-Shell Internationalization
- FDR-001: Roles & Permissions
- FDR-033: Default Grades and Permission Templates
