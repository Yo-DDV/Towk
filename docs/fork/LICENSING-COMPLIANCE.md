# Conformité des licences

## Frontières

- serveur et CLI : AGPL-3.0-or-later ;
- frontend, documentation, exemples et API publiques listés dans `REUSE.toml` : Apache-2.0 ;
- dépendances tierces : notices conservées dans `NOTICE` et les manifests.

## Contrôles

- ne retirer aucun copyright, SPDX, licence ou notice de l’amont ;
- distribuer `LICENSES/AGPL-3.0-or-later.txt` et `NOTICE` dans l’image ;
- relier chaque image au dépôt public et au SHA exact ;
- exécuter `mise license-check` sur chaque PR ;
- vérifier les licences des nouveaux assets avant tout rebranding.

Le simple changement de nom ou de logo ne transforme pas le code amont en œuvre sans attribution. Les modifications du fork restent publiées avec leur source correspondante lorsque le service est fourni sur le réseau.
