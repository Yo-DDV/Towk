/**
 * Shared test utilities for Vitest specs. Import from `$lib/test-utils`.
 *
 * Conventions:
 * - `q(container, sel)` — querySelector with `HTMLElement` cast for `expect.element()`
 * - `testSnippet(html)` — build a `Snippet` for component children/slot props
 *
 * Keep shared helpers small and explicit so component specs stay readable.
 */
export { q } from './q';
export { testSnippet } from './snippet';
