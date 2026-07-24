import { BASELINE_SHA } from "./core.mjs";

export default {
  file: "README.de.md",
  summary: "Wie diese Metriken entstehen",
  contributorAlt: "Autoren von Towk-Commits und zusammengeführten Pull Requests seit der öffentlichen Gründung des eigenständigen Repositorys",
  body: `  Das Repository erzeugt die SVGs selbst aus der GitHub-API mit seinem auf das
  Repository beschränkten \`GITHUB_TOKEN\`. Ein persönlicher Token oder externer
  Statistikdienst wird nicht verwendet. Der Workflow läuft nach jedem Push auf
  \`main\` und ist täglich ungefähr für **06:17 und 21:17 Uhr Europe/Paris** geplant.

  Die primären Zähler und Autorenranglisten beginnen nach dem öffentlichen
  Gründungs-Merge-Commit des eigenständigen Repositorys \`${BASELINE_SHA}\` vom
  12. Juli 2026. Geerbte Chatto-Historie erscheint dadurch nicht als aktuelle
  Towk-Entwicklung. Die Diagramme behalten rollierende Ansichten über 30 Tage,
  12 Wochen und 12 Monate; Zeiträume vor diesem Gründungspunkt erscheinen mit
  null Aktivität. Commits werden nach dem Gründungs-Commit topologisch aus \`main\`
  ausgewählt und anhand ihres Commit-Zeitstempels in UTC gruppiert. Pull Requests
  werden nach \`merged_at\` ab dem Gründungszeitpunkt gezählt. Ranglisten verwenden
  den GitHub-Login, sofern vorhanden, andernfalls den öffentlichen Namen des
  Commit-Autors. Erkannte Bots erscheinen nicht in den menschlichen Ranglisten,
  sondern separat. Diese Zahlen beschreiben Repository-Aktivität und Git-
  Attribution, nicht den individuellen Arbeitsaufwand. Commit-Nachrichten und
  E-Mail-Adressen werden nicht auf den generierten Branch geschrieben.

  Die SVGs und der maschinenlesbare Snapshot liegen auf dem Branch
  [\`readme-metrics\`](https://github.com/Yo-DDV/Towk/tree/readme-metrics).`,
  replacements: [
    [
      `Ein fokussierter, selbst gehosteter Kommunikationsarbeitsbereich für Teams und Communities.<br />`,
      `Ein fokussierter, selbst gehosteter Arbeitsbereich für die Kommunikation von Teams und Communities.<br />`
    ],
    [
      `> Towk wird aktiv entwickelt und hat Version 1.0 noch nicht erreicht. Verwende
> für wichtige Installationen unveränderliche Releases oder Image-Digests,
> halte getestete Sicherungen bereit und lies vor Upgrades die Versionshinweise.`,
      `> Towk wird aktiv entwickelt und hat Version 1.0 noch nicht erreicht. Verwende
> für wichtige Installationen den exakten Image-Digest oder Quellcode-Commit,
> halte getestete Sicherungen bereit und prüfe vor Upgrades die Versionshinweise
> sowie Konfigurationsänderungen.`
    ],
    [
      `<p><strong>Die Grundlagen verdienen erstklassige Aufmerksamkeit.</strong> Towk priorisiert Gespräche, Dateien, Benachrichtigungen und Anrufe, statt zu einer Plattform für alles zu werden.</p>`,
      `<p><strong>Die täglich genutzten Grundlagen verdienen besondere Sorgfalt.</strong> Towk priorisiert Gespräche, Dateien, Benachrichtigungen und Anrufe, statt zu einer Plattform für alles zu werden.</p>`
    ],
    [
      `> **Selbsthosting ist kein Häkchen.** Es bedeutet, selbst zu bestimmen, wo der`,
      `> **Selbsthosting ist mehr als ein Häkchen in einer Funktionsliste.** Es bedeutet, selbst zu bestimmen, wo der`
    ],
    [
      `<p>Optionale LiveKit-Sprach-/Videoräume, Bildschirmfreigabe, E2EE für Anrufmedien und eine installierbare responsive PWA.</p>`,
      `<p>Optionale Sprach- und Videoanrufe über LiveKit, Bildschirmfreigabe, E2EE für Anrufmedien und eine installierbare responsive PWA.</p>`
    ],
    [
      `<p>Passwort-/E-Mail-Flows, OIDC und ausgewählte OAuth-Anbieter sowie verschlüsselte Entwürfe, Postausgang und letzte Verläufe in unterstützten Browsern.</p>`,
      `<p>Passwort-/E-Mail-Abläufe, OIDC und ausgewählte OAuth-Anbieter sowie verschlüsselte Entwürfe, Postausgang und jüngste Raumverläufe in unterstützten Browsern.</p>`
    ],
    [
      `<p>Protobuf-orientierte ConnectRPC-APIs, Echtzeit-WebSocket-Frames, Operator-CLI/API, Health-Endpunkte, Metriken und Mehrserver-Client.</p>`,
      `<p>Protobuf-basierte ConnectRPC-APIs, Echtzeit-WebSocket-Frames, Operator-CLI/API, Health-Endpunkte, Metriken und Mehrserver-Client.</p>`
    ],
    [
      `Die Oberfläche ist auf **Englisch, Deutsch, Französisch, Spanisch und Portugiesisch**
verfügbar. Ausführliches Verhalten, Abwägungen und aktuelle Grenzen stehen in den
[Feature Decision Records](docs/fdr/INDEX.md).`,
      `Die Oberfläche ist auf **Englisch, Deutsch, Französisch, Spanisch und Portugiesisch**
verfügbar. Ausführliches Verhalten, Abwägungen und aktuelle Grenzen stehen in den
[Feature Decision Records](docs/fdr/INDEX.md). Die verlinkte technische
Dokumentation wird derzeit auf Englisch gepflegt.`
    ],
    [
      `<td width="33%" valign="top"><h3>🏠 Bereitstellung</h3><p>Betreibe einen unabhängigen Server je Organisation oder Community — vom kompakten Binary bis zur replizierten Installation.</p></td>`,
      `<td width="33%" valign="top"><h3>🏠 Bereitstellung</h3><p>Jede Installation dient einer Organisation oder Community — von der kompakten Binärdatei bis zur replizierten Topologie.</p></td>`
    ],
    [
      `<td width="33%" valign="top"><h3>📦 Build-Nachvollziehbarkeit</h3><p>Öffentlicher Quellcode, unveränderliche Koordinaten, OCI-Metadaten zum exakten Commit, SBOMs, Schwachstellenscans und Provenienzbestätigungen.</p></td>`,
      `<td width="33%" valign="top"><h3>📦 Build-Nachvollziehbarkeit</h3><p>Öffentlicher Quellcode, OCI-Metadaten zum exakten Commit, Image-Digests, SBOMs, Schwachstellenscans und Provenienzbestätigungen.</p></td>`
    ],
    [
      `<td width="33%" valign="top"><h3>📈 Betriebliche Transparenz</h3><p>Health-/Readiness-Endpunkte, Prometheus-kompatible Metriken, Diagnosen, administratives Ereignisprotokoll und reproduzierbare Performance-Gates.</p></td>`,
      `<td width="33%" valign="top"><h3>📈 Betriebliche Transparenz</h3><p>Health-/Readiness-Endpunkte, Prometheus-kompatible Metriken, Diagnosen, administratives Ereignisprotokoll und ein reproduzierbares Qualifikationsprotokoll für Medienleistung.</p></td>`
    ],
    [
      `> Feldverschlüsselung. LiveKit-Anrufmedien unterstützen E2EE, wenn Anrufe
> aktiviert sind.`,
      `> Feldverschlüsselung. LiveKit-Anrufmedien verwenden E2EE, wenn Anrufe
> aktiviert sind; Towk stellt jedoch den gemeinsamen Anrufschlüssel bereit. Ein
> Towk-Betreiber mit Zugriff auf diese Schlüssel bleibt daher Teil der
> Vertrauensgrenze des Anrufs.`
    ],
    [
      `<h3>⚡ Eigenständiges Binary</h3>`,
      `<h3>⚡ Eigenständige Binärdatei</h3>`
    ],
    [
      `Für dauerhafte Installationen solltest du ein unveränderliches Image-Tag samt
Digest statt eines beweglichen Tags verwenden.`,
      `Für dauerhafte Installationen solltest du einen exakten Image-Digest verwenden,
statt dich auf ein bewegliches Tag zu verlassen.`
    ]
  ],
  required: [
    "weder** ein föderiertes Protokoll",
    "nicht Ende-zu-Ende-verschlüsselt",
    "Vertrauensgrenze des Anrufs",
    "Gründungs-Merge-Commit",
    "GitHub-Login, sofern vorhanden",
    "nicht den individuellen Arbeitsaufwand",
    "verlinkte technische\nDokumentation"
  ]
};
