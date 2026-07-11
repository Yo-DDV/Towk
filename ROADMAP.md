# Roadmap du fork

## Gate 0 — Gouvernance

- fork et remote amont vérifiés ;
- stratégie de branches, licences, source et versioning documentés ;
- synchronisation amont isolée dans une PR.

## Gate 1 — Baseline reproductible

- tests, licences et build verts ;
- image OCI propre au fork, sans `latest` ;
- SBOM, scan, provenance, labels et digest conservés.

## Gate 2 — Pilote deployment host

- NATS, Towk et LiveKit épinglés ;
- routage HTTPS/WSS exclusivement via HAProxy `edge-router` ;
- média LiveKit sur des ports L4 dédiés sans collision ;
- sauvegarde et restauration isolée testées.

## Gate 3 — PWA et notifications

- installation, offline shell, mise à jour du service worker et badge testés ;
- Web Push mesuré sur Chrome/Edge desktop, Android et iOS écran d’accueil ;
- rotation VAPID et limites d’arrière-plan documentées.

## Gate 4 — Appels et réseau

- appel audio/vidéo et partage d’écran testés entre deux réseaux ;
- UDP direct, fallback TCP et TURN vérifiés ;
- besoin TURN/TLS 443 arbitré.

## Gate 5 — Décision produit

- écarts Matrix/Element et Nextcloud Talk documentés ;
- rebranding et migration arbitrés ;
- FDR des invitations d’appel validé avant implémentation.

## Gate 6 — Appels entrants

Cette gate est explicitement hors de la mission initiale. Aucun développement ne commence sans validation de Yoan après lecture des audits et mesures PWA.
