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

Towk n’utilise pas les workflows de release `chattocorp`. Une release propre au projet devra définir son canal stable/prerelease, son changelog, sa signature et ses règles de promotion. Tant que cette politique n’est pas validée, seules des images `dev-<sha>` sont publiées.
