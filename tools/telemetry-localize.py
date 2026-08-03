from __future__ import annotations

import json
from pathlib import Path

TRANSLATIONS = {
    "en": {
        "media_telemetry_limit_bandwidth": "Bandwidth",
        "media_telemetry_limit_cpu": "Processor",
        "media_telemetry_limit_other": "Other",
    },
    "fr": {
        "media_telemetry_limit_bandwidth": "Bande passante",
        "media_telemetry_limit_cpu": "Processeur",
        "media_telemetry_limit_other": "Autre",
    },
    "de": {
        "media_telemetry_limit_bandwidth": "Bandbreite",
        "media_telemetry_limit_cpu": "Prozessor",
        "media_telemetry_limit_other": "Sonstiges",
    },
    "es": {
        "media_telemetry_limit_bandwidth": "Ancho de banda",
        "media_telemetry_limit_cpu": "Procesador",
        "media_telemetry_limit_other": "Otro",
    },
    "pt": {
        "media_telemetry_limit_bandwidth": "Largura de banda",
        "media_telemetry_limit_cpu": "Processador",
        "media_telemetry_limit_other": "Outro",
    },
}


def patch_catalog(locale: str, values: dict[str, str]) -> None:
    path = Path(f"apps/frontend/messages/{locale}/voice.json")
    catalog = json.loads(path.read_text(encoding="utf-8"))
    voice = catalog.get("voice")
    if not isinstance(voice, dict):
        raise SystemExit(f"{locale}: voice catalog missing")
    for key, value in values.items():
        if key in voice:
            raise SystemExit(f"{locale}: {key} already exists")
        voice[key] = value
    path.write_text(json.dumps(catalog, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected one match, found {count}")
    return text.replace(old, new, 1)


def patch_panel() -> None:
    path = Path("apps/frontend/src/lib/components/voice/ParticipantMediaTelemetryPanel.svelte")
    text = path.read_text(encoding="utf-8")
    anchor = """  function format(value: number | null, unit: string): string {
    return value === null
      ? m['voice.connection_metric_unavailable']()
      : `${value.toLocaleString(undefined, { maximumFractionDigits: 1 })}${unit}`;
  }

"""
    addition = anchor + """  function healthLabel(health: ParticipantMediaMetric['health']): string {
    return health === 'excellent'
      ? m['voice.screen_stats_health_excellent']()
      : health === 'good'
        ? m['voice.screen_stats_health_good']()
        : health === 'degraded'
          ? m['voice.screen_stats_health_degraded']()
          : health === 'poor'
            ? m['voice.screen_stats_health_poor']()
            : m['voice.screen_stats_health_unknown']();
  }

  function limitationLabel(
    limitation: Exclude<ParticipantMediaMetric['qualityLimitationReason'], null>
  ): string {
    return limitation === 'bandwidth'
      ? m['voice.media_telemetry_limit_bandwidth']()
      : limitation === 'cpu'
        ? m['voice.media_telemetry_limit_cpu']()
        : m['voice.media_telemetry_limit_other']();
  }

"""
    text = replace_once(text, anchor, addition, "telemetry panel label helpers")
    text = replace_once(text, "{metric.health}</span", "{healthLabel(metric.health)}</span", "health label")
    text = replace_once(
        text,
        "{metric.qualityLimitationReason}</dd>",
        "{limitationLabel(metric.qualityLimitationReason)}</dd>",
        "limitation label",
    )
    path.write_text(text, encoding="utf-8")


def main() -> None:
    for locale, values in TRANSLATIONS.items():
        patch_catalog(locale, values)
    patch_panel()


if __name__ == "__main__":
    main()
