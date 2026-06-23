# ADR 0002 — Client ECS direct (REST/JSON + signature AK/SK) plutôt qu'un SDK Huawei

- **Statut** : Accepté
- **Date** : 2026-06-23

## Contexte

Le code tourne dans un **Cloudflare Worker** (runtime V8 isolé, pas Node complet). Le projet AWS de
référence n'utilise **pas** le SDK AWS : il appelle EC2 directement via `aws4fetch` (~154 lignes,
zéro dépendance lourde). Il faut un équivalent pour Huawei ECS/VPC/EIP/KPS.

## Options

| Option | Description | Verdict |
|---|---|---|
| **A. SDK Huawei (`huaweicloud-sdk-*`)** | SDK officiel Node/JS | ❌ Lourd, pensé pour Node, surface d'API et dépendances non garanties compatibles Workers ; va à l'encontre du style « pas de dépendances lourdes ». |
| **B. Client REST direct + signature AK/SK maison (WebCrypto)** | ~100-150 lignes, calquées sur `aws.ts` | ✅ **Retenu.** |

## Décision

Implémenter un **client REST minimal** appelant directement les API Huawei (ECS, VPC/EIP, KPS, IMS),
avec une **signature AK/SK « SDK-HMAC-SHA256 »** écrite en **WebCrypto** :
- `src/huawei-sign.ts` — signature isolée et **testée** (vecteurs de la doc Huawei).
- `src/huawei.ts` — implémente le contrat `CloudProvider` (cf. architecture/01).

La signature Huawei est **plus simple** que SigV4 (clé = SK directement, pas de chaîne de dérivation
date/région/service), donc le coût d'implémentation est faible et maîtrisé.

## Conséquences

**Positives**
- Cohérent avec le style du projet (léger, sans dépendance lourde, compatible Workers).
- Surface d'API **maîtrisée** : on n'expose que ce dont on a besoin (aligne avec l'IAM minimal).
- Réponses **JSON** (vs XML AWS) → on supprime le parsing regex fragile de `aws.ts`.

**Négatives / coûts**
- Signature à écrire et tester soi-même → mitigé par l'isolement (`huawei-sign.ts`) et des vecteurs
  de test officiels.
- Suivre manuellement d'éventuels changements d'API → périmètre restreint, faible surface.

## Notes d'implémentation

- En-têtes signés : `Host`, `X-Sdk-Date`, `Content-Type`, `X-Project-Id`.
- `launchInstance` est **asynchrone** (renvoie `job_id`) → résolu par le réconciliateur
  (`resolveLaunch`), pas de polling bloquant dans la requête HTTP.
- Inconnues à lever avant exécution : type de clé KPS (ed25519/RSA), version exacte de l'API Create
  ECS, modèle EIP (bloc `publicip` vs EIP API). Voir architecture/01 §7.
