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

Towk n’utilise pas les workflows de release de `chattocorp`. Les releases
Towk suivent le processus autonome décrit dans [`docs/RELEASING.md`](../RELEASING.md) :
Release Please prépare une pull request versionnée, puis le workflow Towk
construit et atteste les archives depuis un tag immuable appartenant à `main`.

Une release GitHub stable ne crée pas encore d’alias OCI stable. Les images
restent publiées sous un tag immuable `dev-<sha>` et doivent être épinglées par
digest jusqu’à ce qu’un changement revu étende explicitement le pipeline de
release aux images stables.
