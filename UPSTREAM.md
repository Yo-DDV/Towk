# Relation avec l’amont

## Synchroniser

```sh
git fetch --tags --prune origin
git fetch --tags --prune upstream
git switch main
git pull --ff-only origin main
git switch -c chore/upstream-sync-YYYY-MM-DD
git merge --ff-only upstream/main
```

Avant publication, vérifier la CI réelle du commit `upstream/main`, puis exécuter au minimum les licences, les tests et le build localement. Une CI de pull request verte ne remplace pas la CI du commit fusionné sur `main`.

Les conflits ou commits propres au fork interdisent le `--ff-only`. Dans ce cas, ouvrir une synchronisation dédiée, documenter la divergence et rejouer toutes les preuves après résolution. Ne jamais écraser l’historique du fork pour simplifier une mise à jour.
