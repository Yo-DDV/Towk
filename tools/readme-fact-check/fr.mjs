import { BASELINE_SHA } from "./core.mjs";

export default {
  file: "README.fr.md",
  summary: "Comment ces métriques sont produites",
  contributorAlt: "Auteurs des commits et des pull requests fusionnées de Towk depuis la fondation publique du dépôt autonome",
  body: `  Le dépôt génère lui-même ces SVG à partir de l’API GitHub avec son
  \`GITHUB_TOKEN\` limité au dépôt ; aucun jeton personnel ni service de statistiques
  externe n’est utilisé. Le workflow s’exécute après chaque push sur \`main\` et est
  planifié approximativement à **06 h 17 et 21 h 17, heure de Paris**, chaque jour.

  Les compteurs principaux et les classements commencent après le commit public de
  fondation du dépôt autonome \`${BASELINE_SHA}\`, fusionné le 12 juillet 2026.
  L’historique hérité de Chatto n’est ainsi pas présenté comme de l’activité Towk
  actuelle. Les graphiques conservent des vues glissantes sur 30 jours, 12 semaines
  et 12 mois ; les périodes antérieures à cette fondation apparaissent à zéro. Les
  commits sont sélectionnés topologiquement depuis \`main\` après ce commit, puis
  regroupés selon leur horodatage de commit en UTC. Les pull requests sont comptées
  selon \`merged_at\` après l’horodatage de fondation. Les classements utilisent
  l’identifiant GitHub lorsqu’il existe, sinon le nom public de l’auteur du commit.
  Les robots détectés sont exclus des classements humains et présentés séparément.
  Ces chiffres décrivent l’activité du dépôt et l’attribution Git, pas l’effort
  individuel. Les messages de commit et les adresses électroniques ne sont pas
  écrits sur la branche générée.

  Les SVG et l’instantané lisible par machine sont publiés sur la branche
  [\`readme-metrics\`](https://github.com/Yo-DDV/Towk/tree/readme-metrics).`,
  replacements: [
    [
      `Un espace de communication auto-hébergé et volontairement ciblé pour les équipes et les communautés.<br />`,
      `Un espace de communication auto-hébergé et volontairement centré sur l’essentiel pour les équipes et les communautés.<br />`
    ],
    [
      `> Towk est en développement actif et n’a pas encore atteint la version 1.0. Pour
> un déploiement important, épinglez une version ou un digest d’image immuable,
> conservez des sauvegardes dont la restauration est testée et consultez les
> notes de version avant chaque mise à niveau.`,
      `> Towk est en développement actif et n’a pas encore atteint la version 1.0. Pour
> un déploiement important, épinglez le digest exact de l’image ou le commit source,
> conservez des sauvegardes dont la restauration est testée et consultez les notes
> de version ainsi que les changements de configuration avant chaque mise à niveau.`
    ],
    [
      `<p><strong>Les fondamentaux méritent une attention de premier ordre.</strong> Towk privilégie les conversations, les fichiers, les notifications et les appels plutôt que de devenir une plateforme à tout faire.</p>`,
      `<p><strong>Les fonctions essentielles méritent un soin particulier.</strong> Towk privilégie les conversations, les fichiers, les notifications et les appels plutôt que de devenir une plateforme à tout faire.</p>`
    ],
    [
      `Passez à NATS externe, au stockage compatible S3, à plusieurs réplicas et à LiveKit`,
      `Passez à NATS externe, au stockage compatible S3, à plusieurs répliques et à LiveKit`
    ],
    [
      `<p>Pièces jointes, traitement d’images, messages vocaux, aperçus de liens, navigation par fichiers de salon et traitement vidéo facultatif.</p>`,
      `<p>Pièces jointes, traitement d’images, messages vocaux, aperçus de liens, consultation des fichiers d’un salon et traitement vidéo facultatif.</p>`
    ],
    [
      `<p>Salons voix/vidéo LiveKit facultatifs, partage d’écran, chiffrement de bout en bout des médias d’appel et PWA responsive installable.</p>`,
      `<p>Appels vocaux et vidéo facultatifs via LiveKit, partage d’écran, chiffrement de bout en bout des médias d’appel et PWA responsive installable.</p>`
    ],
    [
      `<p>Flux par mot de passe et e-mail, OIDC et fournisseurs OAuth sélectionnés, brouillons, boîte d’envoi et historiques récents chiffrés sur les navigateurs pris en charge.</p>`,
      `<p>Flux par mot de passe et e-mail, OIDC et fournisseurs OAuth sélectionnés, brouillons, boîte d’envoi et historiques récents de salons chiffrés sur les navigateurs pris en charge.</p>`
    ],
    [
      `<p>API ConnectRPC basées sur Protobuf, trames WebSocket temps réel, CLI/API opérateur, endpoints de santé, métriques et client multiserveur.</p>`,
      `<p>API ConnectRPC fondées sur Protobuf, trames WebSocket temps réel, CLI/API opérateur, endpoints de santé, métriques et client multiserveur.</p>`
    ],
    [
      `Les comportements détaillés, compromis et limites actuelles sont consignés dans
les [Feature Decision Records](docs/fdr/INDEX.md).`,
      `Les comportements détaillés, compromis et limites actuelles sont consignés dans
les [Feature Decision Records](docs/fdr/INDEX.md). La documentation technique liée
est actuellement maintenue en anglais.`
    ],
    [
      `<td width="33%" valign="top"><h3>🏠 Déploiement</h3><p>Exploitez un serveur indépendant par organisation ou communauté, du binaire compact jusqu’au déploiement répliqué.</p></td>`,
      `<td width="33%" valign="top"><h3>🏠 Déploiement</h3><p>Chaque déploiement dessert une organisation ou une communauté, du binaire compact jusqu’à une topologie répliquée.</p></td>`
    ],
    [
      `<td width="33%" valign="top"><h3>📦 Traçabilité des builds</h3><p>Code source public, coordonnées immuables, métadonnées OCI du commit exact, SBOM, analyses de vulnérabilités et attestations de provenance.</p></td>`,
      `<td width="33%" valign="top"><h3>📦 Traçabilité des builds</h3><p>Code source public, métadonnées OCI du commit exact, digests d’images, SBOM, analyses de vulnérabilités et attestations de provenance.</p></td>`
    ],
    [
      `<td width="33%" valign="top"><h3>📈 Visibilité opérationnelle</h3><p>Endpoints de santé et de disponibilité, métriques compatibles Prometheus, diagnostics, journal administratif et contrôles de performance reproductibles.</p></td>`,
      `<td width="33%" valign="top"><h3>📈 Visibilité opérationnelle</h3><p>Endpoints de santé et de disponibilité, métriques compatibles Prometheus, diagnostics, journal administratif et protocole reproductible de qualification des performances médias.</p></td>`
    ],
    [
      `> médias d’appel LiveKit prennent en charge le chiffrement de bout en bout lorsque
> les appels sont activés.`,
      `> médias d’appel LiveKit utilisent le chiffrement de bout en bout lorsque les
> appels sont activés, mais Towk fournit la clé d’appel partagée ; un opérateur Towk
> capable d’accéder à ces clés reste dans le périmètre de confiance de l’appel.`
    ],
    [
      `Pour un déploiement durable, utilisez un tag d’image immuable accompagné de son
digest plutôt qu’un tag mouvant.`,
      `Pour un déploiement durable, épinglez un digest d’image exact plutôt que de vous
fier à un tag flottant.`
    ],
    [
      `les
artefacts serveur groupés sont sous AGPL-3.0-or-later par défaut`,
      `les
artefacts de distribution du serveur sont sous AGPL-3.0-or-later par défaut`
    ]
  ],
  required: [
    "ni** un protocole fédéré",
    "d’un chiffrement de bout en bout",
    "reste dans le périmètre de confiance de l’appel",
    "fondation du dépôt autonome",
    "l’identifiant GitHub lorsqu’il existe",
    "l’attribution Git, pas l’effort individuel",
    "documentation technique liée"
  ]
};
