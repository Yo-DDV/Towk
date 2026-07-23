<div align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="branding/towk-horizontal-on-dark.webp" />
    <source media="(prefers-color-scheme: light)" srcset="branding/towk-horizontal-on-light.webp" />
    <img src="branding/towk-horizontal-on-light.webp" alt="Towk" width="520" />
  </picture>

  <h3>Open-Source-Kommunikation unter Ihrer Kontrolle.</h3>

  <p>
    Ein fokussierter, selbst gehosteter Kommunikationsraum für Teams und Communities.<br />
    Räume, Direktnachrichten, Dateien, Benachrichtigungen, Sprache und Video — auf Ihrer eigenen Infrastruktur.
  </p>

  <p>
    <a href="README.md">English</a> ·
    <a href="README.fr.md">Français</a> ·
    <strong>Deutsch</strong> ·
    <a href="README.es.md">Español</a> ·
    <a href="README.pt.md">Português</a>
  </p>

  <p>
    <a href="https://github.com/Yo-DDV/Towk/releases/latest"><img src="https://img.shields.io/github/v/release/Yo-DDV/Towk?style=flat-square&amp;sort=semver&amp;display_name=tag&amp;label=release" alt="Neueste Version" /></a>
    <a href="https://github.com/Yo-DDV/Towk/actions/workflows/quick-gate.yml"><img src="https://github.com/Yo-DDV/Towk/actions/workflows/quick-gate.yml/badge.svg?branch=main" alt="Quick Gate" /></a>
    <a href="SECURITY.md"><img src="https://img.shields.io/badge/security-policy-43d8b0?style=flat-square" alt="Sicherheitsrichtlinie" /></a>
    <a href="LICENSING.md"><img src="https://img.shields.io/badge/license-AGPL--3.0--or--later%20%2B%20Apache--2.0-7867f2?style=flat-square" alt="Lizenz" /></a>
    <img src="https://img.shields.io/badge/status-pre--1.0-f59e0b?style=flat-square" alt="Pre-1.0-Status" />
  </p>

  <p>
    <a href="#warum-towk"><strong>Warum Towk</strong></a> ·
    <a href="#was-towk-bietet"><strong>Funktionen</strong></a> ·
    <a href="#souveränität-in-der-praxis"><strong>Souveränität</strong></a> ·
    <a href="#sicherheit-mit-klaren-grenzen"><strong>Sicherheit</strong></a> ·
    <a href="#betreiben-sie-towk-auf-ihre-weise"><strong>Bereitstellung</strong></a> ·
    <a href="#lokal-ausprobieren"><strong>Schnellstart</strong></a>
  </p>
</div>

> [!IMPORTANT]
> Towk ist **Pre-1.0-Software in aktiver Entwicklung**. Wichtige Installationen sollten an eine unveränderliche Version, einen Image-Digest oder einen Quell-Commit gebunden sein. Bewahren Sie getestete Sicherungen auf und lesen Sie vor Upgrades die Versionshinweise.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="apps/docs-website/src/assets/towk_dark.png" />
  <source media="(prefers-color-scheme: light)" srcset="apps/docs-website/src/assets/towk_light.png" />
  <img src="apps/docs-website/src/assets/towk_light.png" alt="Towk-Arbeitsbereich mit Raumnavigation, Unterhaltung und Mitgliederverzeichnis" width="1440" />
</picture>

## Warum Towk

| 🧭 **Souveränität als Ausgangspunkt** | 💬 **Fokussierte Kommunikation** | 🔎 **Nachvollziehbare Entwicklung** |
|---|---|---|
| Betreiben Sie Server, Domain, Identität, Speicher, Sicherungen und Upgrade-Zeitplan selbst. Es gibt kein zentrales Towk-Konto, keinen verpflichtenden Hosting-Dienst und keine integrierte Produktanalyse. | Towk konzentriert sich auf tägliche Kommunikationsabläufe, statt zu einer immer komplexeren Universalsuite zu werden. | Quellcode, API-Verträge, Architekturentscheidungen, Sicherheitsgrenzen und Release-Herkunft sind sichtbar und prüfbar. |

Towk richtet sich an Organisationen und Communities, die moderne Zusammenarbeit wollen, **ohne die operative und datenbezogene Hoheit an einen Dritten abzugeben**. Jeder Server ist unabhängig; Konten und Community-Daten verbleiben in der Infrastruktur und unter den Regeln des jeweiligen Betreibers.

Die installierbare PWA kann sich direkt mit mehreren unabhängigen Towk-Servern verbinden. Nutzer erhalten damit einen gemeinsamen Client, ohne eine zentrale Identität, eine gemeinsame Datenebene oder eine Föderationsschicht einzuführen.

## Was Towk bietet

| | |
|---|---|
| **💬 Strukturierte Unterhaltungen**<br />Räume, Direktnachrichten, Antworten, Threads, Reaktionen, Erwähnungen, Suche, Präsenz und schneller Raumwechsel. | **📎 Inhalte für den Alltag**<br />Dateianhänge, Sprachnachrichten, Bild- und optionale Videoverarbeitung, Link-Vorschauen und geschützte Asset-Auslieferung. |
| **🔔 Aufmerksamkeit ohne unnötigen Lärm**<br />Echtzeitbenachrichtigungen, Web Push, Badges, Benachrichtigungsstufen pro Raum und direkte Navigation zur relevanten Unterhaltung. | **🎙 Sprache, Video und Bildschirmfreigabe**<br />Raumgebundene LiveKit-Anrufe mit Kamera, Bildschirmfreigabe, Geräteauswahl, Wiederverbindung und Medien-E2EE. |
| **🧭 Eine responsive PWA**<br />Desktop- und Mobil-Layouts, Installationshilfen, Offline-Shell, verschlüsselte lokale Entwürfe und Warteschlange, Betriebssystem-Freigabe und progressive Geräteintegrationen. | **🛡 Verständliche Administration**<br />Integrierte und benutzerdefinierte Rollen, granulare Berechtigungen, raumspezifische Überschreibungen, Mitgliederverwaltung, Server-Branding, Diagnosen und administratives Ereignisprotokoll. |
| **🌍 Mehrsprachige Oberfläche**<br />Englisch, Französisch, Deutsch, Spanisch und Portugiesisch werden im aktuellen Client gepflegt. | **🔌 Offene Integrationsoberfläche**<br />ConnectRPC und Protocol Buffers für öffentliche APIs sowie ein Protobuf-Echtzeit-WebSocket für Live-Aktualisierungen. |

## Bewusst fokussiert

Towk will weder Marktplatz noch soziales Netzwerk oder ausufernde Unternehmenssuite sein. Die Produktrichtung ist bewusst enger gefasst:

- Unterhaltungen sollen schnell erreichbar, lesbar und wiederauffindbar sein;
- Benachrichtigungen sollen nützlich statt überwältigend sein;
- Dateien, Anrufe und Administration bleiben nahe an dem Raum, in dem die Arbeit stattfindet;
- die Grundlagen werden auf Desktop, Tablet und Mobilgeräten verbessert, ohne das Produkt in voneinander abweichende Clients aufzuteilen;
- Einschränkungen und Sicherheitsgrenzen werden offengelegt, statt hinter Marketingformulierungen verborgen zu werden.

Dieser Fokus ist Teil des Produkts und kein vorübergehender Mangel an Ambition.

## Souveränität in der Praxis

| Sie entscheiden | Towk stellt bereit |
|---|---|
| **Identität** | Integrierte E-Mail-/Passwort-Abläufe oder externe OAuth/OIDC-Anbieter. Konten bleiben serverlokal. |
| **Datenebene** | Eingebettetes NATS für kompakte Installationen oder externes NATS/JetStream für eine explizitere Topologie. |
| **Dateispeicher** | Standardmäßig NATS Object Store, mit S3-kompatiblem Speicher für größere Asset-Workloads. |
| **Anrufe** | Optionale LiveKit-Integration. Die Anrufoberfläche wird ausgeblendet, wenn LiveKit nicht konfiguriert ist. |
| **Clientzugriff** | Eine browserbasierte PWA, die sich direkt mit den vom Nutzer hinzugefügten Servern verbindet. |
| **Betrieb** | CLI-Werkzeuge, Sicherungs- und Schlüsselexportpfade, Prometheus-kompatible Metriken, unveränderliche Release-Artefakte und dokumentierte Rollback-Erwartungen. |

Towk ist **nicht föderiert**: Server tauschen keine Community-Daten aus. Jede Installation bleibt ihre eigene administrative und datenschutzrechtliche Grenze.

Selbsthosting schafft nicht automatisch Compliance, gibt Betreibern jedoch die Kontrolle, um Hosting-Standort, Identität, Speicher, Sicherungen und Zugriffsrichtlinien an die eigenen Anforderungen anzupassen.

## Sicherheit mit klaren Grenzen

Towk macht Sicherheitsentscheidungen nachvollziehbar, statt absolute Versprechen abzugeben.

| Grenze | Aktueller Ansatz |
|---|---|
| **Autorisierung** | Durchsetzung an den API-Grenzen mit integrierten und benutzerdefinierten RBAC-Rollen, expliziten Freigaben und Verweigerungen, raumspezifischen Überschreibungen und Owner-Wiederherstellung. |
| **Sitzungen** | Undurchsichtige serverseitige Zugangsdaten, signierte Browser-Cookies, Widerruf durch Löschen des Laufzeitstatus und Begrenzung von Authentifizierungsversuchen. |
| **Geschützte dauerhafte Felder** | Nachrichtentext und ausgewählte Kontofelder werden vor der dauerhaften Speicherung mit benutzerspezifischem Schlüsselmaterial verschlüsselt. |
| **Transport und Browseroberfläche** | HTTPS-Unterstützung, restriktive Antwort-Header, Herkunftsprüfungen, begrenzte Anfragegrößen und geschützte Asset-Auslieferung. |
| **Sicherungen und Betrieb** | Optional mit age verschlüsselte Archive, getrennte Schlüsselbehandlung, private Betreiberautomatisierung über einen Unix-Socket und Prometheus-kompatibles Monitoring. |

> [!NOTE]
> Towk bietet keine pauschale Ende-zu-Ende-Verschlüsselung für normale Nachrichten. Der laufende Server muss geschützte Felder für autorisierte Clients entschlüsseln. Anhänge, Avatare und ein erheblicher Teil der Metadaten liegen außerhalb der anwendungsseitigen Verschlüsselungshülle und benötigen Schutz auf Infrastrukturebene. Sprach- und Videomedien können LiveKit-E2EE verwenden.

Lesen Sie das genaue Modell, bevor Sie Towk für sensible Einsatzfälle bewerten:

- [Sicherheitsrichtlinie](SECURITY.md)
- [Leitfaden zu Sicherheit und Datenschutz](apps/docs-website/src/content/docs/guides/operations/security.mdx)
- [Verschlüsselung im Ruhezustand und Datenlöschung](apps/docs-website/src/content/docs/guides/operations/privacy-erasure.mdx)
- [Sicherung und Wiederherstellung](apps/docs-website/src/content/docs/guides/operations/backup-restore.mdx)

## Betreiben Sie Towk auf Ihre Weise

| Pfad | Geeignet für | Aufbau |
|---|---|---|
| **Einzelne Binärdatei** | Evaluierung, kleine Teams und einfache VMs | Eingebetteter Webclient, APIs und NATS in einem kompakten Prozess. |
| **Docker Compose** | Die meisten selbst gehosteten Server | Towk mit explizitem NATS, Caddy und optionalem LiveKit auf einem Host. |
| **Kubernetes / externe Dienste** | Betreiber mit bestehender Plattform | Externes NATS, S3-kompatibler Speicher, LiveKit und mehrere Towk-Replikate, sofern die umgebende Infrastruktur qualifiziert ist. |

Towk benötigt weder MySQL noch PostgreSQL. Dauerhafter Anwendungszustand basiert auf NATS JetStream und Projektionen; der Webclient ist in die Go-Serverdistribution kompiliert.

## Lokal ausprobieren

Towk verwendet [mise](https://mise.jdx.dev/), um die festgelegte Entwicklungswerkzeugkette bereitzustellen.

```sh
git clone https://github.com/Yo-DDV/Towk.git
cd Towk
mise trust
mise run setup
mise dev
```

Öffnen Sie <http://localhost:4000>.

Dieser Entwicklungspfad verwendet lokale Bootstrap-Fixtures. Verwenden Sie Entwicklungszugangsdaten oder -vorgaben niemals in einer öffentlichen Installation.

Für dauerhafte Installationen beginnen Sie mit:

- [Einführung](apps/docs-website/src/content/docs/getting-started/introduction.mdx)
- [Schnellstart](apps/docs-website/src/content/docs/getting-started/quick-start.mdx)
- [Vor der Bereitstellung lesen](apps/docs-website/src/content/docs/guides/deployment/read-this-first.mdx)
- [Architektur](docs/ARCHITECTURE.md)

## Projektstatus und Erwartungen

Towk wird als unabhängiges, öffentliches Pre-1.0-Projekt gepflegt.

- Öffentliche APIs und Bereitstellungsverträge können sich während der `0.x`-Reihe noch ändern.
- Wichtige Installationen sollten unveränderliche Versionen und getestete Wiederherstellungsverfahren verwenden.
- Die PWA ist der aktuelle Desktop- und Mobilclient; App-Store-Pakete werden derzeit nicht veröffentlicht.
- Towk bietet derzeit weder eine gehostete Edition noch einen kommerziellen Supportplan.
- Fehler, fokussierte Funktionsvorschläge und Fragen zum Selbsthosting werden über [GitHub Issues](https://github.com/Yo-DDV/Towk/issues/new/choose) bearbeitet.
- Sicherheitslücken müssen gemäß [SECURITY.md](SECURITY.md) privat gemeldet werden.

Die Roadmap ist nachweisorientiert: Abgeschlossene Arbeit muss im Repository vorhanden sein, während geplante Arbeit weiterhin Entwurf und Validierung erfordert. Siehe [ROADMAP.md](ROADMAP.md).

## Dokumentation und Projektunterlagen

| Bedarf | Referenz |
|---|---|
| Produkteinführung und Bereitstellung | [Dokumentationsquellen](apps/docs-website/src/content/docs/) |
| Architektur und APIs | [Architekturinventar](docs/ARCHITECTURE.md) · [ADRs](docs/adr/INDEX.md) · [FDRs](docs/fdr/INDEX.md) |
| Betrieb und Sicherheit | [Sicherheit](SECURITY.md) · [Support](SUPPORT.md) · [Leistungsqualifizierung](docs/PERFORMANCE.md) |
| Projektprozess | [Governance](GOVERNANCE.md) · [Beitragsleitfaden](CONTRIBUTING.md) · [Roadmap](ROADMAP.md) |
| Herkunft und Kompatibilität | [Provenienz](PROVENANCE.md) · [Upstream-Richtlinie](UPSTREAM.md) · [Korrespondierender Quellcode](SOURCE.md) |

## Lizenz und Herkunft

Towk bewahrt das dateibasierte Lizenzmodell des Repositorys:

- Server, CLI und gebündelte Serverdistribution stehen grundsätzlich unter **AGPL-3.0-or-later**;
- ausdrücklich ausgewiesene Bereiche des Frontends, der öffentlichen APIs, der Dokumentation und der Beispiele stehen unter **Apache-2.0**;
- die genaue maschinenlesbare Grenze ist in [REUSE.toml](REUSE.toml) definiert; Hinweise zu Drittanbietern stehen in [NOTICE](NOTICE).

Towk ist ein unabhängiges Projekt auf Basis von [Chatto](https://github.com/chattocorp/chatto). Es bewahrt Urheberschaft, Hinweise und Kompatibilitätsverträge des Upstreams und trifft zugleich eigene Produkt-, Release- und Supportentscheidungen. Towk wird von ChattoCorp GmbH weder befürwortet noch gesponsert, betrieben oder unterstützt.
