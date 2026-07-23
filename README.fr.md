<div align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="branding/towk-horizontal-on-dark.webp" />
    <source media="(prefers-color-scheme: light)" srcset="branding/towk-horizontal-on-light.webp" />
    <img src="branding/towk-horizontal-on-light.webp" alt="Towk" width="520" />
  </picture>

  <h3>La communication open source qui reste la vôtre.</h3>

  <p>
    Un espace de communication auto-hébergé et volontairement ciblé pour les équipes et les communautés.<br />
    Salons, messages directs, fichiers, notifications, voix et vidéo — sur une infrastructure que vous contrôlez.
  </p>

  <p>
    <a href="README.md">English</a> ·
    <strong>Français</strong> ·
    <a href="README.de.md">Deutsch</a> ·
    <a href="README.es.md">Español</a> ·
    <a href="README.pt.md">Português</a>
  </p>

  <p>
    <a href="https://github.com/Yo-DDV/Towk/releases/latest"><img src="https://img.shields.io/github/v/release/Yo-DDV/Towk?style=flat-square&amp;sort=semver&amp;display_name=tag&amp;label=version" alt="Dernière version" /></a>
    <a href="https://github.com/Yo-DDV/Towk/actions/workflows/quick-gate.yml"><img src="https://github.com/Yo-DDV/Towk/actions/workflows/quick-gate.yml/badge.svg?branch=main" alt="Contrôle rapide" /></a>
    <a href="SECURITY.md"><img src="https://img.shields.io/badge/security-policy-43d8b0?style=flat-square" alt="Politique de sécurité" /></a>
    <a href="LICENSING.md"><img src="https://img.shields.io/badge/licence-AGPL--3.0--or--later%20%2B%20Apache--2.0-7867f2?style=flat-square" alt="Licence" /></a>
    <img src="https://img.shields.io/badge/status-pre--1.0-f59e0b?style=flat-square" alt="Statut pré-1.0" />
  </p>

  <p>
    <a href="#pourquoi-towk"><strong>Pourquoi Towk</strong></a> ·
    <a href="#ce-que-towk-propose"><strong>Fonctionnalités</strong></a> ·
    <a href="#souveraineté-en-pratique"><strong>Souveraineté</strong></a> ·
    <a href="#sécurité-avec-des-limites-explicites"><strong>Sécurité</strong></a> ·
    <a href="#déployez-le-à-votre-façon"><strong>Déploiement</strong></a> ·
    <a href="#essayez-le-localement"><strong>Démarrage rapide</strong></a>
  </p>
</div>

> [!IMPORTANT]
> Towk est un logiciel **pré-1.0 en développement actif**. Pour tout déploiement important, épinglez une version, un digest d'image ou un commit immuable, conservez des sauvegardes dont la restauration est testée et lisez les notes de version avant chaque mise à niveau.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="apps/docs-website/src/assets/towk_dark.png" />
  <source media="(prefers-color-scheme: light)" srcset="apps/docs-website/src/assets/towk_light.png" />
  <img src="apps/docs-website/src/assets/towk_light.png" alt="Espace Towk avec navigation des salons, conversation et annuaire des membres" width="1440" />
</picture>

## Pourquoi Towk

| 🧭 **Souveraineté par défaut** | 💬 **Communication ciblée** | 🔎 **Ingénierie transparente** |
|---|---|---|
| Exploitez le serveur, le domaine, l'identité, le stockage, les sauvegardes et le rythme des mises à niveau. Aucun compte Towk central, service hébergé obligatoire ni outil d'analyse produit intégré. | Towk se concentre sur les usages de communication quotidiens au lieu de devenir une suite universelle toujours plus complexe. | Le code source, les contrats d'API, les décisions d'architecture, les limites de sécurité et la provenance des versions sont visibles et auditables. |

Towk s'adresse aux organisations et aux communautés qui veulent une collaboration moderne **sans confier leur frontière opérationnelle et leurs données à un tiers**. Chaque serveur est indépendant ; ses comptes et ses données restent dans l'infrastructure et sous les règles choisies par son opérateur.

La PWA installable peut se connecter directement à plusieurs serveurs Towk indépendants. Les utilisateurs disposent ainsi d'un client unique sans créer d'identité centrale, de plan de données partagé ni de couche de fédération.

## Ce que Towk propose

| | |
|---|---|
| **💬 Des conversations structurées**<br />Salons, messages directs, réponses, fils de discussion, réactions, mentions, recherche, présence et navigation rapide entre les salons. | **📎 Des contenus utiles au quotidien**<br />Pièces jointes, messages vocaux, traitement des images et, en option, des vidéos, aperçus de liens et diffusion protégée des ressources. |
| **🔔 Attirer l'attention sans ajouter de bruit**<br />Notifications en temps réel, Web Push, badges, niveaux de notification par salon et retour direct vers la conversation concernée. | **🎙 Voix, vidéo et partage d'écran**<br />Appels LiveKit liés aux salons avec caméra, partage d'écran, choix des périphériques, reprise après déconnexion et chiffrement E2EE des médias. |
| **🧭 Une seule PWA réactive**<br />Interfaces bureau et mobile, accompagnement à l'installation, shell hors ligne, brouillons et file d'envoi locale chiffrés, partage depuis le système et intégrations progressives avec l'appareil. | **🛡 Une administration qui reste compréhensible**<br />Rôles intégrés et personnalisés, permissions granulaires, dérogations par salon, gestion des membres, personnalisation du serveur, diagnostics et journal d'événements administratifs. |
| **🌍 Une interface multilingue**<br />L'anglais, le français, l'allemand, l'espagnol et le portugais sont maintenus dans le client actuel. | **🔌 Une surface d'intégration ouverte**<br />ConnectRPC et Protocol Buffers pour les API publiques, complétés par un WebSocket protobuf pour les mises à jour en temps réel. |

## Ciblé par conception

Towk ne cherche pas à devenir une place de marché, un réseau social ou une suite métier tentaculaire. Sa direction produit est volontairement plus précise :

- rendre les conversations rapides à rejoindre, lire et retrouver ;
- rendre les notifications utiles plutôt qu'envahissantes ;
- garder les fichiers, les appels et l'administration proches du salon où se déroule le travail ;
- améliorer les fondamentaux sur ordinateur, tablette et mobile sans diviser le produit en plusieurs clients divergents ;
- exposer les limites et les frontières de sécurité au lieu de les masquer derrière des formulations marketing.

Cette concentration fait partie du produit ; ce n'est pas un manque d'ambition temporaire.

## Souveraineté en pratique

| Vous choisissez | Towk fournit |
|---|---|
| **Identité** | Parcours intégrés par e-mail et mot de passe, ou fournisseurs OAuth/OIDC externes. Les comptes restent propres à chaque serveur. |
| **Couche de données** | NATS intégré pour les installations compactes, ou NATS/JetStream externe pour une topologie plus explicite. |
| **Stockage des fichiers** | NATS Object Store par défaut, avec un stockage compatible S3 pour les volumes de ressources plus importants. |
| **Appels** | Intégration LiveKit facultative. L'interface d'appel disparaît lorsque LiveKit n'est pas configuré. |
| **Accès client** | Une PWA fournie par le navigateur qui se connecte directement aux serveurs ajoutés par l'utilisateur. |
| **Exploitation** | Outils CLI, chemins de sauvegarde et d'export de clés, métriques compatibles Prometheus, artefacts de version immuables et attentes de rollback documentées. |

Towk n'est **pas fédéré** : les serveurs n'échangent pas les données de leurs communautés. Chaque déploiement reste sa propre frontière administrative et de protection des données.

L'auto-hébergement ne crée pas la conformité à lui seul, mais il donne aux opérateurs le contrôle nécessaire pour aligner le lieu d'hébergement, l'identité, le stockage, les sauvegardes et les politiques d'accès sur leurs propres exigences.

## Sécurité avec des limites explicites

Towk cherche à rendre les décisions de sécurité vérifiables plutôt qu'absolues.

| Frontière | Approche actuelle |
|---|---|
| **Autorisation** | Contrôle aux frontières des API avec rôles RBAC intégrés et personnalisés, autorisations et refus explicites, dérogations par salon et récupération du rôle propriétaire. |
| **Sessions** | Identifiants opaques conservés côté serveur, cookies navigateur signés, révocation par suppression de l'état d'exécution et limitation des tentatives d'authentification. |
| **Champs durables protégés** | Le texte des messages et certains champs de compte sont chiffrés avant leur stockage durable à l'aide de clés propres à l'utilisateur. |
| **Transport et surface navigateur** | HTTPS, en-têtes de réponse restrictifs, contrôle des origines, tailles de requête bornées et diffusion protégée des ressources. |
| **Sauvegardes et exploitation** | Archives chiffrables avec age, gestion séparée des clés, automatisation opérateur privée via socket Unix et supervision compatible Prometheus. |

> [!NOTE]
> Towk ne fournit pas un chiffrement de bout en bout généralisé pour les messages ordinaires. Le serveur en fonctionnement doit déchiffrer les champs protégés pour les clients autorisés. Les pièces jointes, les avatars et une part importante des métadonnées restent hors de l'enveloppe de chiffrement applicative de Towk et nécessitent une protection au niveau de l'infrastructure. Les médias voix et vidéo peuvent utiliser l'E2EE de LiveKit.

Consultez le modèle exact avant d'évaluer Towk pour des usages sensibles :

- [Politique de sécurité](SECURITY.md)
- [Guide sécurité et confidentialité](apps/docs-website/src/content/docs/guides/operations/security.mdx)
- [Chiffrement au repos et effacement des données](apps/docs-website/src/content/docs/guides/operations/privacy-erasure.mdx)
- [Sauvegarde et restauration](apps/docs-website/src/content/docs/guides/operations/backup-restore.mdx)

## Déployez-le à votre façon

| Parcours | Cas d'usage | Composition |
|---|---|---|
| **Binaire unique** | Évaluation, petites équipes et machines virtuelles simples | Client web, API et NATS intégrés dans un processus compact. |
| **Docker Compose** | La majorité des serveurs auto-hébergés | Towk avec NATS explicite, Caddy et LiveKit facultatif sur un même hôte. |
| **Kubernetes / services externes** | Opérateurs disposant déjà d'une plateforme | NATS externe, stockage compatible S3, LiveKit et plusieurs réplicas Towk lorsque l'infrastructure environnante est qualifiée. |

Towk ne nécessite ni MySQL ni PostgreSQL. L'état applicatif durable repose sur NATS JetStream et des projections, tandis que le client web est compilé dans la distribution du serveur Go.

## Essayez-le localement

Towk utilise [mise](https://mise.jdx.dev/) pour fournir sa chaîne d'outils de développement épinglée.

```sh
git clone https://github.com/Yo-DDV/Towk.git
cd Towk
mise trust
mise run setup
mise dev
```

Ouvrez <http://localhost:4000>.

Ce parcours de développement utilise des fixtures d'initialisation locales. Ne réutilisez jamais les identifiants ou réglages de développement dans un déploiement public.

Pour un déploiement durable, commencez par :

- [Introduction](apps/docs-website/src/content/docs/getting-started/introduction.mdx)
- [Démarrage rapide](apps/docs-website/src/content/docs/getting-started/quick-start.mdx)
- [À lire avant de déployer](apps/docs-website/src/content/docs/guides/deployment/read-this-first.mdx)
- [Architecture](docs/ARCHITECTURE.md)

## Statut du projet et attentes

Towk est maintenu comme un projet indépendant, public et pré-1.0.

- Les API publiques et les contrats de déploiement peuvent encore évoluer pendant la série `0.x`.
- Les déploiements importants doivent utiliser des versions immuables et des procédures de restauration testées.
- La PWA est actuellement le client bureau et mobile ; aucune application distribuée par les stores n'est publiée à ce jour.
- Towk ne propose actuellement ni édition hébergée ni offre de support commercial.
- Les bugs, propositions de fonctionnalités ciblées et questions d'auto-hébergement sont traités dans les [issues GitHub](https://github.com/Yo-DDV/Towk/issues/new/choose).
- Les vulnérabilités doivent être signalées en privé selon [SECURITY.md](SECURITY.md).

La roadmap repose sur des preuves : un travail terminé doit exister dans le dépôt, tandis qu'un travail planifié reste soumis à conception et validation. Voir [ROADMAP.md](ROADMAP.md).

## Documentation et références du projet

| Besoin | Référence |
|---|---|
| Présentation du produit et déploiement | [Sources de la documentation](apps/docs-website/src/content/docs/) |
| Architecture et API | [Inventaire d'architecture](docs/ARCHITECTURE.md) · [ADR](docs/adr/INDEX.md) · [FDR](docs/fdr/INDEX.md) |
| Exploitation et sécurité | [Sécurité](SECURITY.md) · [Support](SUPPORT.md) · [Qualification des performances](docs/PERFORMANCE.md) |
| Processus du projet | [Gouvernance](GOVERNANCE.md) · [Guide de participation](CONTRIBUTING.md) · [Roadmap](ROADMAP.md) |
| Origine et compatibilité | [Provenance](PROVENANCE.md) · [Politique amont](UPSTREAM.md) · [Source correspondante](SOURCE.md) |

## Licence et origine

Towk conserve le modèle de licence fichier par fichier du dépôt :

- le serveur, la CLI et la distribution serveur groupée sont généralement sous licence **AGPL-3.0-or-later** ;
- les surfaces explicitement identifiées du frontend, des API publiques, de la documentation et des exemples sont sous licence **Apache-2.0** ;
- la frontière exacte et lisible par machine est définie par [REUSE.toml](REUSE.toml), avec les mentions tierces dans [NOTICE](NOTICE).

Towk est un projet indépendant basé sur [Chatto](https://github.com/chattocorp/chatto). Il conserve les auteurs, les mentions et les contrats de compatibilité amont tout en prenant ses propres décisions produit, de version et de support. Towk n'est ni approuvé, ni sponsorisé, ni exploité, ni pris en charge par ChattoCorp GmbH.
