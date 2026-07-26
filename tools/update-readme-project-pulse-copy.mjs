import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const ROOT = process.cwd();
const BASELINE_SHA = "205e91fe1ae5e5c23420974f7e04cf82456eeab3";
const ACTIVITY_BADGE = "https://img.shields.io/badge/activity-GitHub%20Actions%20%2F%206h-7867f2?style=flat-square";

export const EDITIONS = {
  en: {
    file: "README.md", navLabel: "Repository activity", title: "Repository activity",
    badgeAlt: "Repository activity refreshed by GitHub Actions every six hours",
    imageAlt: "Towk repository activity over the last 30 UTC days: commits, merged pull requests, closed issues, active contributors, code movement and pull request flow",
    summary: "How these metrics are produced",
    body: `  The repository generates this SVG and its machine-readable snapshot from
  its own Git history and the GitHub API with the workflow's scoped
  \`GITHUB_TOKEN\`; no personal token or external statistics service is used. The
  workflow runs after every push to \`main\`, approximately every six hours, and
  on manual dispatch.

  Every headline value and chart uses the same rolling **30 UTC-day** window. The
  public standalone-repository baseline is commit \`${BASELINE_SHA}\`, merged on
  12 July 2026; while that baseline falls inside the rolling window, earlier days
  remain zero so inherited Chatto history is not presented as current Towk
  activity. The current UTC day is explicitly marked as partial.

  Commits are selected topologically from \`main\` and bucketed by committed
  timestamp. Additions, deletions and changed-file counts come from Git
  \`--numstat\`; binary files count as changed files but do not invent line totals.
  Pull requests are counted by \`merged_at\` when merged into \`main\`, and issues
  are counted by \`closed_at\` with pull requests excluded. Merge lead time is
  measured from \`created_at\` to \`merged_at\`. First-review time is measured from
  \`created_at\` to the first submitted review by a human who is not the pull
  request author; pull requests without such a review are omitted from that median.
  Active contributors are the distinct human commit and merged-PR authors in the
  window. Bots are excluded only from that human count; repository totals include
  automation.

  These figures describe repository activity, not individual effort. Raw commit
  messages, email addresses, review bodies and contributor rankings are not written
  to the generated branch. The SVGs and snapshot live on
  [\`readme-metrics\`](https://github.com/Yo-DDV/Towk/tree/readme-metrics).`
  },
  fr: {
    file: "README.fr.md", navLabel: "Activité du dépôt", title: "Activité du dépôt",
    badgeAlt: "Activité du dépôt actualisée par GitHub Actions toutes les six heures",
    imageAlt: "Activité du dépôt Towk sur les 30 derniers jours UTC : commits, pull requests fusionnées, issues fermées, contributeurs actifs, mouvement du code et flux des pull requests",
    summary: "Comment ces métriques sont produites",
    body: `  Le dépôt génère lui-même ce SVG et son instantané lisible par machine à
  partir de son historique Git et de l’API GitHub, avec le \`GITHUB_TOKEN\` limité
  du workflow ; aucun jeton personnel ni service de statistiques externe n’est
  utilisé. Le workflow s’exécute après chaque push sur \`main\`, approximativement
  toutes les six heures, ainsi qu’à la demande.

  Toutes les valeurs principales et tous les graphiques utilisent la même fenêtre
  glissante de **30 jours UTC**. Le point de départ public du dépôt autonome est le
  commit \`${BASELINE_SHA}\`, fusionné le 12 juillet 2026 ; tant qu’il se trouve
  dans cette fenêtre, les jours antérieurs restent à zéro afin de ne pas présenter
  l’historique hérité de Chatto comme de l’activité Towk actuelle. Le jour UTC en
  cours est explicitement signalé comme partiel.

  Les commits sont sélectionnés topologiquement depuis \`main\` et regroupés selon
  leur horodatage de commit. Les ajouts, suppressions et nombres de fichiers
  modifiés proviennent de Git \`--numstat\` ; un fichier binaire compte comme
  fichier modifié sans inventer de total de lignes. Les pull requests sont comptées
  selon \`merged_at\` lorsqu’elles sont fusionnées dans \`main\`, et les issues selon
  \`closed_at\`, pull requests exclues. Le délai de fusion va de \`created_at\` à
  \`merged_at\`. Le délai de première revue va de \`created_at\` à la première revue
  soumise par une personne différente de l’auteur ; les pull requests sans revue
  correspondante sont exclues de cette médiane. Les contributeurs actifs sont les
  auteurs humains distincts de commits et de PR fusionnées sur la période. Les
  robots sont exclus uniquement de ce nombre humain ; les totaux du dépôt incluent
  l’automatisation.

  Ces chiffres décrivent l’activité du dépôt, pas l’effort individuel. Les messages
  de commit, adresses électroniques, corps de revue et classements d’auteurs ne sont
  pas écrits sur la branche générée. Les SVG et l’instantané sont publiés sur
  [\`readme-metrics\`](https://github.com/Yo-DDV/Towk/tree/readme-metrics).`
  },
  de: {
    file: "README.de.md", navLabel: "Repository-Aktivität", title: "Repository-Aktivität",
    badgeAlt: "Repository-Aktivität wird alle sechs Stunden durch GitHub Actions aktualisiert",
    imageAlt: "Towk-Repository-Aktivität der letzten 30 UTC-Tage: Commits, zusammengeführte Pull Requests, geschlossene Issues, aktive Mitwirkende, Codebewegung und Pull-Request-Durchlauf",
    summary: "Wie diese Metriken entstehen",
    body: `  Das Repository erzeugt dieses SVG und den maschinenlesbaren Snapshot aus
  seinem eigenen Git-Verlauf und der GitHub-API mit dem beschränkten
  \`GITHUB_TOKEN\` des Workflows. Ein persönlicher Token oder externer
  Statistikdienst wird nicht verwendet. Der Workflow läuft nach jedem Push auf
  \`main\`, ungefähr alle sechs Stunden sowie bei manueller Ausführung.

  Alle Kennzahlen und Diagramme verwenden dasselbe rollierende Fenster von
  **30 UTC-Tagen**. Der öffentliche Ausgangspunkt des eigenständigen Repositorys
  ist Commit \`${BASELINE_SHA}\`, gemergt am 12. Juli 2026. Solange dieser Punkt im
  Fenster liegt, bleiben frühere Tage bei null, damit geerbte Chatto-Historie nicht
  als aktuelle Towk-Aktivität erscheint. Der aktuelle UTC-Tag ist ausdrücklich als
  unvollständig gekennzeichnet.

  Commits werden topologisch aus \`main\` ausgewählt und nach Commit-Zeitstempel
  gruppiert. Hinzugefügte und gelöschte Zeilen sowie geänderte Dateien stammen aus
  Git \`--numstat\`; Binärdateien zählen als geänderte Dateien, erzeugen aber keine
  erfundenen Zeilensummen. Pull Requests zählen nach \`merged_at\`, wenn sie in
  \`main\` zusammengeführt wurden; Issues zählen nach \`closed_at\`, Pull Requests
  sind ausgeschlossen. Die Merge-Durchlaufzeit reicht von \`created_at\` bis
  \`merged_at\`. Die Zeit bis zur ersten Review reicht von \`created_at\` bis zur
  ersten eingereichten Review eines Menschen, der nicht der PR-Autor ist; PRs ohne
  passende Review werden aus diesem Median ausgelassen. Aktive Mitwirkende sind
  die unterschiedlichen menschlichen Commit- und Merge-PR-Autoren im Fenster.
  Bots sind nur aus dieser menschlichen Zahl ausgeschlossen; Repository-Summen
  enthalten Automation.

  Diese Zahlen beschreiben Repository-Aktivität, nicht individuelle Leistung.
  Commit-Nachrichten, E-Mail-Adressen, Review-Texte und Autorenranglisten werden
  nicht auf den generierten Branch geschrieben. SVGs und Snapshot liegen auf
  [\`readme-metrics\`](https://github.com/Yo-DDV/Towk/tree/readme-metrics).`
  },
  es: {
    file: "README.es.md", navLabel: "Actividad del repositorio", title: "Actividad del repositorio",
    badgeAlt: "Actividad del repositorio actualizada por GitHub Actions cada seis horas",
    imageAlt: "Actividad del repositorio Towk durante los últimos 30 días UTC: commits, pull requests fusionadas, issues cerradas, colaboradores activos, movimiento de código y flujo de pull requests",
    summary: "Cómo se generan estas métricas",
    body: `  El repositorio genera este SVG y su instantánea legible por máquina a partir
  de su propio historial Git y de la API de GitHub, con el \`GITHUB_TOKEN\`
  limitado del workflow; no utiliza un token personal ni un servicio externo de
  estadísticas. El workflow se ejecuta después de cada push a \`main\`,
  aproximadamente cada seis horas y también de forma manual.

  Todos los valores principales y gráficos usan la misma ventana móvil de
  **30 días UTC**. El punto de partida público del repositorio independiente es el
  commit \`${BASELINE_SHA}\`, fusionado el 12 de julio de 2026; mientras siga
  dentro de la ventana, los días anteriores permanecen en cero para no presentar
  el historial heredado de Chatto como actividad actual de Towk. El día UTC actual
  se marca explícitamente como incompleto.

  Los commits se seleccionan topológicamente desde \`main\` y se agrupan por su
  marca temporal de commit. Las adiciones, eliminaciones y archivos modificados
  proceden de Git \`--numstat\`; los archivos binarios cuentan como modificados sin
  inventar totales de líneas. Las pull requests se cuentan por \`merged_at\` cuando
  se fusionan en \`main\`, y las issues por \`closed_at\`, excluyendo pull requests.
  El tiempo hasta la fusión va de \`created_at\` a \`merged_at\`. El tiempo hasta la
  primera revisión va de \`created_at\` a la primera revisión enviada por una
  persona que no sea el autor; las pull requests sin una revisión válida se omiten
  de esa mediana. Los colaboradores activos son los distintos autores humanos de
  commits y PR fusionadas dentro de la ventana. Los bots se excluyen solo de ese
  recuento humano; los totales del repositorio incluyen automatización.

  Estas cifras describen la actividad del repositorio, no el esfuerzo individual.
  Los mensajes de commit, correos electrónicos, textos de revisión y rankings de
  autores no se escriben en la rama generada. Los SVG y la instantánea se publican
  en [\`readme-metrics\`](https://github.com/Yo-DDV/Towk/tree/readme-metrics).`
  },
  pt: {
    file: "README.pt.md", navLabel: "Atividade do repositório", title: "Atividade do repositório",
    badgeAlt: "Atividade do repositório atualizada pelo GitHub Actions a cada seis horas",
    imageAlt: "Atividade do repositório Towk nos últimos 30 dias UTC: commits, pull requests integradas, issues fechadas, colaboradores ativos, movimento do código e fluxo das pull requests",
    summary: "Como estas métricas são produzidas",
    body: `  O repositório gera este SVG e o seu instantâneo legível por máquina a partir
  do próprio histórico Git e da API do GitHub, usando o \`GITHUB_TOKEN\` limitado
  do workflow; não usa um token pessoal nem um serviço externo de estatísticas. O
  workflow é executado depois de cada push para \`main\`, aproximadamente a cada
  seis horas e também por execução manual.

  Todos os valores principais e gráficos usam a mesma janela móvel de
  **30 dias UTC**. O ponto de partida público do repositório independente é o
  commit \`${BASELINE_SHA}\`, integrado em 12 de julho de 2026; enquanto estiver
  dentro da janela, os dias anteriores permanecem a zero para não apresentar o
  histórico herdado do Chatto como atividade atual do Towk. O dia UTC atual é
  explicitamente assinalado como incompleto.

  Os commits são selecionados topologicamente a partir de \`main\` e agrupados pelo
  respetivo carimbo temporal de commit. As adições, remoções e ficheiros alterados
  vêm de Git \`--numstat\`; ficheiros binários contam como alterados sem inventar
  totais de linhas. As pull requests são contadas por \`merged_at\` quando são
  integradas em \`main\`, e as issues por \`closed_at\`, excluindo pull requests. O
  tempo até à integração vai de \`created_at\` a \`merged_at\`. O tempo até à
  primeira revisão vai de \`created_at\` à primeira revisão submetida por uma pessoa
  diferente do autor; pull requests sem uma revisão válida são omitidas dessa
  mediana. Os colaboradores ativos são os autores humanos distintos de commits e
  PR integradas dentro da janela. Os bots são excluídos apenas dessa contagem
  humana; os totais do repositório incluem automação.

  Estes números descrevem a atividade do repositório, não o esforço individual.
  Mensagens de commit, endereços de email, textos de revisão e classificações de
  autores não são escritos no ramo gerado. Os SVG e o instantâneo são publicados
  em [\`readme-metrics\`](https://github.com/Yo-DDV/Towk/tree/readme-metrics).`
  }
};

function escapeRegex(value) { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function section(locale, edition) {
  return `<a id="repository-activity"></a>
## ${edition.title}

<picture>
  <source media="(max-width: 600px)" srcset="https://raw.githubusercontent.com/Yo-DDV/Towk/readme-metrics/${locale}/activity-mobile.svg" />
  <img src="https://raw.githubusercontent.com/Yo-DDV/Towk/readme-metrics/${locale}/activity.svg" width="100%" alt="${edition.imageAlt}" />
</picture>

<details>
  <summary><strong>${edition.summary}</strong></summary>

${edition.body}
</details>`;
}

export function updateEdition(content, locale, edition = EDITIONS[locale]) {
  if (!edition) throw new Error(`Unsupported README locale: ${locale}`);
  const badge = /(<a href="\.github\/workflows\/refresh-readme-metrics\.yml"><img src=")[^"]+(" alt=")[^"]+(" \/><\/a>)/;
  if (!badge.test(content)) throw new Error(`${edition.file}: activity badge was not found`);
  let updated = content.replace(badge, `$1${ACTIVITY_BADGE}$2${edition.badgeAlt}$3`);
  const nav = /(<a href="#)(?:development-pulse|repository-activity)(">)[^<]+(<\/a>)/;
  if (!nav.test(updated)) throw new Error(`${edition.file}: activity navigation link was not found`);
  updated = updated.replace(nav, `$1repository-activity$2${edition.navLabel}$3`);
  const block = /<a id="(?:development-pulse|repository-activity)"><\/a>\n## [^\n]+\n[\s\S]*?\n(?=<a id="capabilities"><\/a>)/;
  const matches = updated.match(new RegExp(block.source, "g")) ?? [];
  if (matches.length !== 1) throw new Error(`${edition.file}: expected one activity section, found ${matches.length}`);
  updated = updated.replace(block, `${section(locale, edition)}\n\n`);
  for (const obsolete of ["contributors.svg", "contributors-mobile.svg", "Development pulse", "Dynamique du développement", "Entwicklungsdynamik", "Ritmo de desarrollo", "Ritmo de desenvolvimento"]) {
    if (updated.includes(obsolete)) throw new Error(`${edition.file}: obsolete activity copy remains: ${obsolete}`);
  }
  if ((updated.match(/<a id="repository-activity"><\/a>/g) ?? []).length !== 1) throw new Error(`${edition.file}: repository activity anchor is not unique`);
  const navLabelPattern = new RegExp(`<a href="#repository-activity">${escapeRegex(edition.navLabel)}<\/a>`, "g");
  const headingPattern = new RegExp(`^## ${escapeRegex(edition.title)}$`, "gm");
  if ((updated.match(navLabelPattern) ?? []).length !== 1 || (updated.match(headingPattern) ?? []).length !== 1) {
    throw new Error(`${edition.file}: activity navigation label and heading must each be unique`);
  }
  return updated;
}

export async function main({ root = ROOT, check = process.argv.includes("--check") } = {}) {
  const changed = [];
  for (const [locale, edition] of Object.entries(EDITIONS)) {
    const file = path.join(root, edition.file), current = await readFile(file, "utf8"), updated = updateEdition(current, locale, edition);
    if (updated !== current) { changed.push(edition.file); if (!check) await writeFile(file, updated, "utf8"); }
  }
  if (check && changed.length) throw new Error(`README repository-activity copy is out of date: ${changed.join(", ")}`);
  process.stdout.write(changed.length ? `Updated README repository activity: ${changed.join(", ")}\n` : "README repository-activity copy is already current\n");
  return changed;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
