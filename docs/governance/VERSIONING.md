# Versioning

## Images de développement

Format :

```text
ghcr.io/yo-ddv/towk:<base>-dev-<short-sha>
```

Le tag ne bouge pas et n’est jamais `latest`. Le Compose de production épingle en plus le digest :

```text
ghcr.io/yo-ddv/towk:0.4.7-dev-<short-sha>@sha256:<digest>
```

## Releases

Towk n’utilise pas les workflows de release du projet amont. Les releases
Towk suivent le processus autonome décrit dans [`docs/RELEASING.md`](../RELEASING.md) :
Release Please prépare une pull request versionnée, puis le workflow Towk
construit et atteste les archives depuis un tag immuable appartenant à `main`.

Le workflow de release publie des archives binaires stables et peut publier une
image OCI stable seulement depuis le tag de release validé sur `main`. Les tags
de développement restent immuables, sans `latest`, et doivent être épinglés par
digest dans les environnements qui privilégient la reproductibilité stricte.
