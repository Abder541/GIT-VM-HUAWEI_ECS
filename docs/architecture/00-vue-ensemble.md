# Architecture — Vue d'ensemble (cible)

> Objectif : une plateforme self-service de VM, **edge-first** (Cloudflare), **cloud-native**
> (Huawei ECS), pilotée par un **réconciliateur idempotent**, sécurisée et observable, conçue
> pour grandir (multi-région, multi-équipe, multi-workload).

## 1. Contexte (qui parle à quoi)

```
                         ┌─────────────────────────────────────────────┐
                         │                  Cloudflare                  │
   Utilisateur           │  ┌────────────┐      ┌────────────────────┐ │
   (étudiant /     ──────┼─▶│  SPA React  │◀────▶│  Worker (Hono)     │ │
    formateur /          │  │  (Assets)   │      │  API JSON + cron   │ │
    validateur)          │  └────────────┘      │  scheduled()       │ │
        │                │                       │   ├─ /auth/* OIDC  │ │
        │  SSO           │                       │   ├─ /api/*        │ │
        ▼                │                       │   └─ réconciliateur│ │
  ┌───────────────┐      │                       └─────────┬──────────┘ │
  │ Microsoft     │◀─────┼────── OIDC ───────────────────  │            │
  │ Entra ID      │      │                  ┌──────────────┴─────┐      │
  └───────────────┘      │                  │  D1 (état désiré)  │      │
                         │                  └────────────────────┘      │
                         └───────────────────────────│─────────────────┘
                                                      │ API ECS signée AK/SK
                                                      ▼
                         ┌─────────────────────────────────────────────┐
                         │              Huawei Cloud (région)           │
                         │  IAM ─ projet ─ VPC ─ Subnet(s) ─ SG(s)      │
                         │  ECS (VM) ─ EVS (disque) ─ EIP ─ KPS (clés)  │
                         │  IMS (images) ─ Cloud Eye (métriques)        │
                         └─────────────────────────────────────────────┘
                                      ▲
                                      │ REST (notifications)
                              ┌───────┴────────┐
                              │   EmailJS      │  (mails : demande / décision / VM prête)
                              └────────────────┘
```

**Acteurs**
- **Membre** (étudiant) : demande une VM, télécharge sa clé, gère le cycle de vie de *ses* VM.
- **Formateur** *(rôle à introduire)* : demande groupée de N machines pour une classe.
- **Validateur / Admin** : approuve/refuse, supervise, gère les rôles, exporte, audite.

## 2. Principe d'exécution — l'état désiré + réconciliation

Le système ne « pilote » pas Huawei en impératif depuis les requêtes HTTP utilisateur. Il **écrit
l'intention en base (D1)** et laisse un **réconciliateur** (cron Cloudflare `scheduled()`) converger
le réel Huawei vers cet état désiré.

```
   requête utilisateur ──▶ D1 (status = pending/approved/…)         [écriture d'intention]
                                     │
   cron */2 min ───────────▶ réconciliateur ──▶ API ECS Huawei      [convergence]
                                     │
                         met à jour D1 + audit + email              [boucle fermée]
```

Avantages : **idempotent**, **résilient aux pannes** (rejoue à chaque tick), **auto-réparant**
(détection de drift), et **un seul endroit** où vit toute la logique de cycle de vie.

### Machine à états d'une demande

```
pending ──approve──▶ approved ──▶ provisioning ──▶ active ──▶ terminated
   │                                   │              │            ▲
   └──reject──▶ rejected               │              │  end_date  │
                                       └─ échec ──▶ failed ─(retry≤3)
                                                      │
                                                      └─ après 3 échecs ▶ failed (définitif)
```

## 3. Couches logiques

| Couche | Rôle | Spécifique Huawei ? |
|---|---|---|
| **Présentation** | SPA React (formulaire, dashboards, admin) | Non — réutilisée telle quelle |
| **API / Auth** | Worker Hono, OIDC Entra, sessions JWT | Non |
| **Domaine** | demandes, décisions, rôles, catalogue, audit | Non |
| **État** | D1 (état désiré + historique) | Non |
| **Orchestration** | réconciliateur (cron) | Logique non, appels oui |
| **Couche fournisseur** | `src/huawei.ts` : ECS, EIP, KPS, signature AK/SK | **Oui — le seul vrai travail** |

> 👉 Seule la dernière ligne change vraiment par rapport à AWS. Voir
> [`01-couche-fournisseur.md`](01-couche-fournisseur.md).

## 4. Parcours de bout en bout (cible parité)

1. **Connexion** : OIDC Entra ID → session JWT (cookie HttpOnly). Domaines email autorisés.
2. **Demande** : l'utilisateur choisit un preset (perf × stockage × OS), une finalité, des
   **dates début/fin**. → `D1: pending`.
3. **Notification** : mail au(x) validateur(s) (EmailJS).
4. **Décision** : le validateur approuve → `D1: approved`.
5. **Provisioning** (réconciliateur) :
   a. Crée une **clé SSH** dédiée (KPS) → stocke la clé privée **chiffrée** (AES-GCM).
   b. Lance l'**ECS** (flavor + image IMS + subnet + SG + EVS) → reçoit un **`job_id`**.
   c. Alloue/associe une **EIP** (IP publique).
   d. `D1: provisioning` (mémorise `job_id`, puis `server_id`).
6. **Convergence** : aux ticks suivants, le réconciliateur résout le job, lit l'IP, passe
   `D1: active` et envoie le mail « VM prête ».
7. **Usage** : l'utilisateur télécharge sa clé, se connecte en SSH ; start/stop/reboot depuis le portail.
8. **Garde-fous coûts** : extinction programmée (cron quotidien) des VM running.
9. **Destruction** : à `end_date`, le réconciliateur **termine l'ECS + libère l'EIP + supprime la
   clé KPS** → `D1: terminated`. Audit + mail.
10. **Drift** : si une VM disparaît hors portail, le réconciliateur la marque `terminated`.

## 5. Décisions transverses (résumé)

| Sujet | Choix | ADR |
|---|---|---|
| Worker distinct, AWS intouché | Oui | [0001](../adr/0001-worker-distinct-et-architecture-first.md) |
| Client ECS direct (REST/JSON + AK/SK) vs SDK Huawei | **Direct, in-Worker** | [0002](../adr/0002-client-ecs-direct-vs-sdk.md) |
| Cycle de vie via réconciliateur | Oui (hérité AWS) | 0004 *(à rédiger)* |
| GitOps GitHub → Cloudflare | Oui | voir [deployment](../deployment/01-gitops.md) |

## 6. Au-delà de la parité (conçu maintenant, activé ensuite)

Voir [feuille de route](../roadmap/00-feuille-de-route.md) — résumé des couches avancées :
**Cloudflare Access** (Zero Trust devant l'admin), **Queues + Durable Objects** (provisioning
événementiel plus réactif que le cron), **segmentation réseau par classe**, **FinOps**
(modèle de coûts + dashboard), **HA / DR** (multi-AZ, sauvegardes, runbooks), **WAF + rate limiting**.
