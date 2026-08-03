from __future__ import annotations

import json
import re
from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected one match, found {count}")
    return text.replace(old, new, 1)


def patch_dialog() -> None:
    path = Path("apps/frontend/src/lib/components/voice/ParticipantMediaTelemetryPanel.svelte")
    text = path.read_text(encoding="utf-8")
    text, count = re.subn(
        r'<section(?=[^>]*\brole="dialog")',
        "<div",
        text,
        count=1,
        flags=re.DOTALL,
    )
    if count != 1:
        raise SystemExit("telemetry dialog opening tag not found")
    closing_index = text.rfind("</section>")
    if closing_index < 0:
        raise SystemExit("telemetry dialog closing tag not found")
    text = text[:closing_index] + "</div>" + text[closing_index + len("</section>") :]
    path.write_text(text, encoding="utf-8")


def patch_german_catalog() -> None:
    path = Path("apps/frontend/messages/de/voice.json")
    catalog = json.loads(path.read_text(encoding="utf-8"))
    flat_key = "voice.media_telemetry_bitrate"
    if flat_key in catalog:
        if catalog[flat_key] != "Bitrate":
            raise SystemExit("unexpected flat German telemetry bitrate value")
        catalog[flat_key] = "Datenrate"
    elif isinstance(catalog.get("voice"), dict):
        voice = catalog["voice"]
        if voice.get("media_telemetry_bitrate") != "Bitrate":
            raise SystemExit("unexpected nested German telemetry bitrate value")
        voice["media_telemetry_bitrate"] = "Datenrate"
    else:
        raise SystemExit("German telemetry bitrate key not found")
    path.write_text(json.dumps(catalog, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def patch_reception_tests() -> None:
    path = Path("apps/frontend/src/lib/state/server/voiceCall.svelte.spec.ts")
    text = path.read_text(encoding="utf-8")
    start_marker = "  it('reports the worst current quality across microphone and screen-share tracks'"
    end_marker = "  it('does not remove an interrupted participant only because its recovery deadline elapsed'"
    start = text.find(start_marker)
    end = text.find(end_marker, start)
    if start < 0 or end < 0:
        raise SystemExit("legacy reception quality test block not found")
    block = text[start:end]
    shape = (
        block.count("networkHealth:"),
        block.count("packetLossPercent:"),
        block.count("jitterMs:"),
        block.count("networkWarningMetric:"),
    )
    if shape != (13, 5, 5, 5):
        raise SystemExit(f"unexpected legacy reception assertion shape: {shape}")
    block = block.replace("networkHealth:", "receptionNetworkHealth:")
    block = block.replace("packetLossPercent:", "receptionPacketLossPercent:")
    block = block.replace("jitterMs:", "receptionJitterMs:")
    block = re.sub(r"^\s*networkWarningMetric:.*\n", "", block, flags=re.MULTILINE)
    block = block.replace(
        "reports the worst current quality across microphone and screen-share tracks",
        "reports the worst current reception quality across microphone and screen-share tracks",
    )
    block = block.replace(
        "clears a participant quality sample when every active track stops reporting stats",
        "clears a participant reception quality sample when every active track stops reporting stats",
    )
    block = block.replace(
        "expires a participant quality sample when a WebRTC stats read never settles",
        "expires a participant reception quality sample when a WebRTC stats read never settles",
    )
    path.write_text(text[:start] + block + text[end:], encoding="utf-8")


def patch_camera_test() -> None:
    path = Path("apps/frontend/src/lib/components/voice/VoiceCallPanel.svelte.spec.ts")
    text = path.read_text(encoding="utf-8")
    start_marker = "  it('offers a one-touch camera switch when several phone lenses are available'"
    end_marker = "  it('keeps unavailable web screen sharing compact and explains it only on tap'"
    start = text.find(start_marker)
    end = text.find(end_marker, start)
    if start < 0 or end < 0:
        raise SystemExit("camera switch component test block not found")
    replacement = """  it('offers a one-touch camera switch when several phone lenses are available', async () => {
    const { container } = render(VoiceCallPanelStoryHarness, {
      props: { layout: 'sidebar', scenario: 'mobile-camera' }
    });

    const control = await vi.waitFor(() => {
      const value = container.querySelector<HTMLButtonElement>(
        '[data-testid=\"call-switch-camera-button\"]'
      );
      expect(value).not.toBeNull();
      return value!;
    });
    expect(control.getAttribute('aria-label')).toBe('Switch camera');
    expect(control.getBoundingClientRect().height).toBeGreaterThanOrEqual(32);
  });

"""
    path.write_text(text[:start] + replacement + text[end:], encoding="utf-8")


def patch_wire_metric_types() -> None:
    path = Path("apps/frontend/src/lib/voice/participantMediaTelemetry.ts")
    text = path.read_text(encoding="utf-8")
    start = text.find("  const latencyMs = optionalBoundedNumber")
    end = text.find("\n}\n\nfunction classifyHealth", start)
    if start < 0 or end < 0:
        raise SystemExit("telemetry wire parser segment not found")
    segment = text[start:end]
    replacements = {
        "    latencyMs,\n": "    latencyMs: latencyMs ?? null,\n",
        "    jitterMs,\n": "    jitterMs: jitterMs ?? null,\n",
        "    packetLossPercent,\n": "    packetLossPercent: packetLossPercent ?? null,\n",
        "    bitrateKbps,\n": "    bitrateKbps: bitrateKbps ?? null,\n",
        "    framesPerSecond,\n": "    framesPerSecond: framesPerSecond ?? null,\n",
        "    width,\n": "    width: width ?? null,\n",
        "    height,\n": "    height: height ?? null,\n",
    }
    for old, new in replacements.items():
        segment = replace_once(segment, old, new, f"wire parser field {old.strip()}")
    path.write_text(text[:start] + segment + text[end:], encoding="utf-8")


def patch_wire_tests() -> None:
    path = Path("apps/frontend/src/lib/voice/participantMediaTelemetry.spec.ts")
    text = path.read_text(encoding="utf-8")
    text = replace_once(text, "entry as RTCStats", "entry as unknown as RTCStats", "RTCStats test cast")
    text = replace_once(
        text,
        "new TextDecoder().decode(payload);",
        "new TextDecoder().decode(payload!);",
        "nullable telemetry payload decode",
    )
    path.write_text(text, encoding="utf-8")


def main() -> None:
    patch_dialog()
    patch_german_catalog()
    patch_reception_tests()
    patch_camera_test()
    patch_wire_metric_types()
    patch_wire_tests()


if __name__ == "__main__":
    main()
