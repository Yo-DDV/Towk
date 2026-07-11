# Synchronisation amont

Une synchronisation est acceptable seulement si :

1. `origin/main` est à jour et le worktree est propre ;
2. `upstream/main` est fetché en direct ;
3. le commit amont ciblé a une CI `main` complète et verte ;
4. la divergence et les changements de licences, schémas, PWA, Push, LiveKit, Compose et workflows sont examinés ;
5. les preuves locales invalidées sont rejouées ;
6. la PR de synchronisation reste séparée des adaptations propres au fork.

Une avance amont apparue pendant la review est classée avant publication : elle remplace la cible si elle est saine et pertinente, ou elle est documentée comme volontairement différée. Aucun « vert » historique ne doit être présenté comme l’état courant sans un nouveau fetch.
