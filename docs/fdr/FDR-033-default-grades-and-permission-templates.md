# FDR-033: Default Grades and Permission Templates

**Status:** Active
**Last reviewed:** 2026-08-06

## Overview

Towk provides five built-in grades that give instance owners a safe and understandable starting point for community governance:

- `owner` — effective instance ownership;
- `admin` — highly trusted delegated administration;
- `moderator` — public-channel moderation;
- `helper` — community assistance without coercive power;
- `everyone` — the implicit Members baseline carried by every authenticated user.

The internal domain and public APIs retain the established term **role**. Product copy may use the natural equivalent for each locale, including **grade** in French administration surfaces.

Role position is display metadata only. It is never an authorization rank. Effective permissions still use ADR-040's owner override and deny-wins resolution for every non-owner.

## Behavior

### Fresh installations

Fresh RBAC state creates all five built-in grades. Helper is pingable by default and has a distinct display accent, but contributes no explicit permission grant. Its members only inherit the ordinary `everyone` baseline.

The recommended server-scope baselines are versioned:

- `members.v1`;
- `helper.v1`;
- `moderator.v1`;
- `admin.v2`.

A later version never mutates an existing grade automatically.

### Helper

Helper is a system grade, not a naming convention or a decorative custom role. It is assignable and revocable, but cannot be deleted or freely reordered. Its name and description are localized from the stable `helper` identifier.

Helper grants no moderation or administration permission by default. Making the role pingable lets room members ask assigned helpers for assistance using `@helper`; normal mention membership, confirmation, mute and notification rules still apply.

### Moderator

`moderator.v1` contributes exactly:

- `room.remove-member`;
- `room.ban-member`;
- `room.lock`;
- `room.bypass-lock`;
- `message.delete-others`.

The template deliberately excludes `room.manage`, `room.purge-messages`, `message.manage`, role administration, account administration and administrative user/audit views.

This lets moderators remove harmful content and contain channel incidents without rewriting another user's message, purging a channel, changing permissions or taking over an account.

### Admin

`admin.v2` is an explicit, audited baseline rather than a category-derived list. It includes broad delegated administration and the channel lock/bypass capabilities, but excludes `room.purge-messages` by default. Adding a new permission to the catalog never silently adds it to Admin.

### Members

`members.v1` is stored on the implicit `everyone` role and grants the ordinary channel and message capabilities documented by FDR-001. A role template never duplicates those inherited permissions.

## Safe Granular Moderation

`message.delete-others` replaces only the delete capability of the broad legacy `message.manage` permission. `room.remove-member` replaces only the explicit member-removal capability of broad `room.manage`.

For each semantic family, deny-wins applies across both the narrow and legacy permission:

- deleting another user's message considers `message.delete-others` and `message.manage`;
- removing a channel member considers `room.remove-member` and `room.manage`.

Any applicable deny in the family blocks that operation. Otherwise any applicable allow grants it. Editing another user's message still requires `message.manage` specifically.

Both narrow permissions are unconditionally unavailable to non-owners inside direct-message rooms.

## Creation From a Template

The bundled client submits role metadata and a stable template identifier in one server command. The server validates the template, creates the role, applies the server baseline and returns only after the resulting policy can be read back. If applying the baseline fails, the just-created role is removed before an error is returned.

The command preserves the existing protobuf request shape for mixed-version compatibility. Older servers receive no unknown protobuf template field that they could silently ignore.

## Existing Installations

Ordinary startup does not inject the new Moderator or Admin permissions into existing deployments. Historical boot backfills remain frozen at their previously supported permissions.

Helper is provisioned idempotently when the role catalog is first read after upgrade. If a role named `helper` already exists, its assignments, policy and metadata are preserved and it is treated as the system Helper grade. If the shared `@helper` handle belongs to an existing user, Towk logs a bounded warning and continues serving; an owner must rename that account before Helper can be provisioned.

Existing Moderators with `message.manage` remain historical until an owner deliberately changes their baseline. Restarting never changes a deliberate `ALLOW`, `DENY` or `NONE` decision into the new recommendation.

## Owner Boundary

An effective owner cannot be targeted by delegated account deletion, channel removal, channel bans or message moderation. The ownership role must first be removed using the dedicated owner-authorized, fresh-authenticated flow. Configured `owners.emails` remain an operator-controlled recovery boundary.

Owners still do not gain membership-based visibility into direct messages they do not participate in.

## Localization

All product text for default grades, templates, risks, permission descriptions and creation/overview surfaces is maintained in English, German, French, Spanish and Portuguese. Stable role and permission identifiers are never translated in durable events.

## Related

- **ADRs:** ADR-040 (permission-only RBAC), ADR-043 (client-shell localization), ADR-058 (default grade catalog)
- **FDRs:** FDR-001 (RBAC), FDR-004 (message editing and deletion), FDR-006 (mentions), FDR-007 (DMs), FDR-024 (permission inspection), FDR-032 (channel lock and purge)
