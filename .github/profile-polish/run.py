from __future__ import annotations

import re
import runpy
from pathlib import Path

_original_subn = re.subn


def _literal_subn(pattern, replacement, string, count=0, flags=0):
    if isinstance(replacement, str):
        return _original_subn(pattern, lambda _match: replacement, string, count=count, flags=flags)
    return _original_subn(pattern, replacement, string, count=count, flags=flags)


re.subn = _literal_subn
runpy.run_path(str(Path(__file__).with_name("apply.py")), run_name="__main__")

spec = Path("apps/frontend/src/lib/components/menus/UserContextMenu.svelte.spec.ts")
text = spec.read_text(encoding="utf-8")
old = """    const content = q(container, '[data-testid=\"profile-biography-content\"]');
    expect(content.classList.contains('profile-biography-content-collapsed')).toBe(true);"""
new = """    const content = q(container, '[data-testid=\"profile-biography-content\"]');
    if (!content) throw new Error('Expected the biography content to be rendered.');
    expect(content.classList.contains('profile-biography-content-collapsed')).toBe(true);"""
if old not in text:
    raise RuntimeError("profile biography content assertion block not found")
spec.write_text(text.replace(old, new, 1), encoding="utf-8")
