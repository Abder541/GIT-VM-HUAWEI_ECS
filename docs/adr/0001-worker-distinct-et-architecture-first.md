# ADR 0001 — Worker Cloudflare distinct & approche architecture-first

- **Statut** : Accepté
- **Date** : 2026-06-23
- **Contexte projet** : portage du portail VM AWS vers Huawei Cloud ECS.

## Contexte

Un portail self-service de VM **fonctionne déjà sur AWS** (Worker Cloudflare déployé,
`Thomas-TP/GIT-VM`). Il faut produire une **édition Huawei Cloud ECS** sans dégrader l'existant, et
on ne dispose **pas encore** d'accès Huawei exploitable.

## Décision

1. L'édition Huawei est un **Worker Cloudflare entièrement distinct** : nom, base D1, domaine,
   secrets et pipeline de déploiement **séparés**. Le Worker AWS n'est **jamais** modifié.
2. Le projet AWS est traité comme **référence en lecture seule** (source de patterns).
3. On adopte une approche **architecture-first** : concevoir l'architecture cible complète et figer
   le **périmètre IAM minimal** *avant* de brancher tout accès Huawei.
4. La **parité fonctionnelle** est l'objectif de la première itération ; les couches avancées sont
   **conçues maintenant**, activées progressivement.

## Conséquences

**Positives**
- Risque nul pour la production AWS.
- Les credentials Huawei ne sont demandés qu'une fois le **strict nécessaire** identifié (sécurité).
- La conception sert de contrat clair avec l'équipe Huawei (liste d'accès précise).

**Négatives / coûts**
- Duplication initiale de code (base du portail copiée) → atténuée par la **couture fournisseur**
  isolée : seule `src/huawei.ts` diffère réellement (cf. ADR 0002).
- Deux Workers à maintenir → acceptable, périmètres disjoints.

## Alternatives écartées

- *Brancher Huawei dans le Worker AWS existant (multi-cloud dans un seul Worker)* : couple les deux
  produits, risque pour la prod AWS, complexité de config. **Rejeté.**
- *Commencer par coder avant de figer l'IAM* : exposerait à demander des droits trop larges.
  **Rejeté** (contraire au moindre privilège).
