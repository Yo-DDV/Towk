import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const ROOT = process.cwd();
const BASELINE_SHA = "205e91fe1ae5e5c23420974f7e04cf82456eeab3";

const EDITIONS = {
  en: {
    file: "README.md",
    summary: "How these metrics are produced",
    contributorAlt: "Towk commit and merged pull request authors since the independent repository baseline",
    body: `  The repository generates these SVGs from GitHub's API with its scoped
  \`GITHUB_TOKEN\`; it does not use a personal token or an external statistics
  service. The workflow refreshes after every push to \`main\` and at approximately
  **06:17 and 21:17 Europe/Paris** each day.

  The primary counters and contributor rankings begin after the public
  standalone-repository baseline commit \`${BASELINE_SHA}\`, merged on 12 July
  2026. This prevents inherited Chatto history from being presented as current
  Towk progress. The charts retain rolling views of 30 days, 12 weeks and 12
  months; commits are selected topologically from \`main\` after the baseline and
  bucketed by their committed timestamp in UTC. Pull requests are counted by
  \`merged_at\` after the baseline date. Contributor rankings use the GitHub
  identity attributed to each selected commit or merged pull request; detected
  bots are excluded from human rankings and reported separately. Raw commit
  messages and email addresses are not written to the generated branch.

  The generated SVGs and machine-readable snapshot live on the
  [\`readme-metrics\`](https://github.com/Yo-DDV/Towk/tree/readme-metrics) branch.`
  },
  fr: {
    file: "README.fr.md",
    summary: "Comment ces métriques sont produites",
    contributorAlt: "Auteurs des commits et des pull requests fusionnées de Towk depuis le point de départ du dépôt indépendant",
    body: `  Le dépôt génère lui-même ces SVG à partir de l’API GitHub avec son
  \`GITHUB_TOKEN\` limité au dépôt ; aucun jeton personnel ni service de statistiques
  externe n’est utilisé. Le workflow s’exécute après chaque push sur \`main\` et
  approximativement à **06 h 17 et 21 h 17, heure de Paris**, chaque jour.

  Les compteurs principaux et les classements commencent après le commit public
  de référence du dépôt autonome \`${BASELINE_SHA}\`, fusionné le 12 juillet 2026.
  L’historique hérité de Chatto n’est ainsi pas présenté comme de l’activité Towk
  actuelle. Les graphiques conservent des vues glissantes sur 30 jours, 12 semaines
  et 12 mois ; les commits sont sélectionnés topologiquement depuis \`main\` après
  ce point de départ, puis regroupés selon leur horodatage de commit en UTC. Les
  pull requests sont comptées selon \`merged_at\` après la date de référence. Les
  classements utilisent l’identité GitHub attribuée à chaque commit sélectionné ou
  pull request fusionnée ; les robots détectés sont exclus des classements humains
  et présentés séparément. Les messages de commit et les adresses électroniques ne
  sont pas écrits sur la branche générée.

  Les SVG et l’instantané lisible par machine sont publiés sur la branche
  [\`readme-metrics\`](https://github.com/Yo-DDV/Towk/tree/readme-metrics).`
  },
  de: {
    file: "README.de.md",
    summary: "Wie diese Metriken entstehen",
    contributorAlt: "Autoren von Towk-Commits und zusammengeführten Pull Requests seit dem Start des eigenständigen Repositorys",
    body: `  Das Repository erzeugt die SVGs selbst aus der GitHub-API mit seinem auf das
  Repository beschränkten \`GITHUB_TOKEN\`. Ein persönlicher Token oder externer
  Statistikdienst ist nicht erforderlich. Der Workflow läuft nach jedem Push auf
  \`main\` sowie täglich ungefähr um **06:17 und 21:17 Uhr in der Zeitzone Europe/Paris**.

  Die primären Zähler und Autorenranglisten beginnen nach dem öffentlichen
  Standalone-Baseline-Commit \`${BASELINE_SHA}\`, das am 12. Juli 2026 gemergt
  wurde. Geerbte Chatto-Historie erscheint dadurch nicht als aktuelle Towk-
  Entwicklung. Die Diagramme behalten rollierende Ansichten über 30 Tage, 12
  Wochen und 12 Monate. Commits werden nach der Baseline topologisch aus \`main\`
  ausgewählt und anhand ihres Commit-Zeitstempels in UTC gruppiert. Pull Requests
  werden nach \`merged_at\` ab dem Baseline-Datum gezählt. Die Ranglisten verwenden
  die GitHub-Identität des jeweiligen ausgewählten Commits oder zusammengeführten
  Pull Requests. Erkannte Bots erscheinen nicht in den menschlichen Ranglisten,
  sondern separat. Commit-Nachrichten und E-Mail-Adressen werden nicht auf den
  generierten Branch geschrieben.

  Die SVGs und der maschinenlesbare Snapshot liegen auf dem Branch
  [\`readme-metrics\`](https://github.com/Yo-DDV/Towk/tree/readme-metrics).`
  },
  es: {
    file: "README.es.md",
    summary: "Cómo se generan estas métricas",
    contributorAlt: "Autores de commits y pull requests fusionadas de Towk desde el punto de partida del repositorio independiente",
    body: `  El propio repositorio genera estos SVG a partir de la API de GitHub con su
  \`GITHUB_TOKEN\` limitado al repositorio; no utiliza un token personal ni un
  servicio externo de estadísticas. El workflow se ejecuta después de cada push
  a \`main\` y aproximadamente a las **06:17 y 21:17 en la zona horaria Europe/Paris**,
  cada día.

  Los contadores principales y las clasificaciones comienzan después del commit
  público de referencia del repositorio independiente \`${BASELINE_SHA}\`,
  fusionado el 12 de julio de 2026. Así, el historial heredado de Chatto no se
  presenta como progreso actual de Towk. Los gráficos mantienen vistas móviles de
  30 días, 12 semanas y 12 meses; los commits se seleccionan topológicamente desde
  \`main\` después de la referencia y se agrupan por su marca temporal de commit
  en UTC. Las pull requests se cuentan por \`merged_at\` después de la fecha de
  referencia. Las clasificaciones usan la identidad de GitHub atribuida a cada
  commit seleccionado o pull request fusionada; los bots detectados se excluyen
  de las clasificaciones humanas y se muestran por separado. Los mensajes de
  commit y las direcciones de correo electrónico no se escriben en la rama
  generada.

  Los SVG y la instantánea legible por máquina se publican en la rama
  [\`readme-metrics\`](https://github.com/Yo-DDV/Towk/tree/readme-metrics).`
  },
  pt: {
    file: "README.pt.md",
    summary: "Como estas métricas são produzidas",
    contributorAlt: "Autores dos commits e pull requests integradas do Towk desde o ponto de partida do repositório independente",
    body: `  O próprio repositório gera estes SVG a partir da API do GitHub com o seu
  \`GITHUB_TOKEN\` limitado ao repositório; não usa um token pessoal nem um serviço
  externo de estatísticas. O workflow é executado depois de cada push para \`main\`
  e aproximadamente às **06:17 e 21:17 no fuso horário Europe/Paris**, todos os
  dias.

  Os contadores principais e as classificações começam depois do commit público
  de referência do repositório independente \`${BASELINE_SHA}\`, integrado em 12
  de julho de 2026. Assim, o histórico herdado do Chatto não é apresentado como
  progresso atual do Towk. Os gráficos mantêm vistas móveis de 30 dias, 12 semanas
  e 12 meses; os commits são selecionados topologicamente a partir de \`main\`
  depois da referência e agrupados pelo respetivo carimbo temporal de commit em
  UTC. As pull requests são contadas por \`merged_at\` depois da data de referência.
  As classificações usam a identidade GitHub atribuída a cada commit selecionado
  ou pull request integrada; os bots detetados são excluídos das classificações
  humanas e apresentados separadamente. As mensagens de commit e os endereços de
  correio eletrónico não são escritos no ramo gerado.

  Os SVG e o instantâneo legível por máquina são publicados no ramo
  [\`readme-metrics\`](https://github.com/Yo-DDV/Towk/tree/readme-metrics).`
  }
};

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function updateEdition(content, locale, edition) {
  const contributorPattern = new RegExp(
    `(<img src="https://raw\\.githubusercontent\\.com/Yo-DDV/Towk/readme-metrics/${locale}/contributors\\.svg" width="100%" alt=")[^"]+(" />)`
  );
  if (!contributorPattern.test(content)) {
    throw new Error(`${edition.file}: contributor image was not found`);
  }
  let updated = content.replace(contributorPattern, `$1${edition.contributorAlt}$2`);

  const detailsPattern = new RegExp(
    `<details>\\n  <summary><strong>${escapeRegex(edition.summary)}</strong></summary>[\\s\\S]*?\\n</details>`
  );
  const matches = updated.match(new RegExp(detailsPattern.source, "g")) ?? [];
  if (matches.length !== 1) {
    throw new Error(`${edition.file}: expected one metrics details block, found ${matches.length}`);
  }
  updated = updated.replace(
    detailsPattern,
    `<details>\n  <summary><strong>${edition.summary}</strong></summary>\n\n${edition.body}\n</details>`
  );
  return updated;
}

export async function main() {
  const changed = [];
  for (const [locale, edition] of Object.entries(EDITIONS)) {
    const file = path.join(ROOT, edition.file);
    const current = await readFile(file, "utf8");
    const updated = updateEdition(current, locale, edition);
    if (updated !== current) {
      await writeFile(file, updated, "utf8");
      changed.push(edition.file);
    }
  }
  process.stdout.write(changed.length > 0
    ? `Updated README pulse copy: ${changed.join(", ")}\n`
    : "README pulse copy is already current\n");
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
