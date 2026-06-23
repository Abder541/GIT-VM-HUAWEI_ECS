// src/types.ts — Bindings d'environnement du Worker Huawei + types de session.
//
// Provider-neutre : côté D1, les identifiants cloud seront nommés SANS préfixe
// fournisseur (`server_id`, `snapshot_id`, `provider_job_id`…) plutôt que `aws_*`
// comme dans le projet de référence — la base Huawei est neuve, on corrige la dette
// cosmétique d'entrée de jeu. Voir ADR 0003.

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;

  // ---- Config publique (wrangler.jsonc → vars) ----------------------------
  ALLOWED_EMAIL_DOMAINS: string; // CSV, ex. "git.swiss"
  ADMIN_EMAILS: string; // CSV
  ENTRA_TENANT_ID: string;
  ENTRA_CLIENT_ID: string;

  // ---- Huawei Cloud (remplace les bindings AWS_*) -------------------------
  HUAWEI_REGION: string; // ex. "eu-west-101" (EU-Dublin)
  HUAWEI_ENDPOINT_SUFFIX?: string; // site Huawei : "myhuaweicloud.eu" (cloud EU/RGPD)
  HUAWEI_PROJECT_ID: string; // projet région-scoped (découvert : 85a8db07…)
  HUAWEI_VPC_ID: string;
  HUAWEI_SUBNET_ID: string; // (puis map classe → subnet pour la segmentation)
  HUAWEI_SECGROUP_ID: string; // (puis map classe → SG)
  HUAWEI_AZ?: string; // zone de disponibilité (ex. "eu-west-101a") — optionnelle
  HUAWEI_IMAGE_ID: string; // image IMS par défaut (catalogue par OS ensuite)
  HUAWEI_EIP_BANDWIDTH?: string; // bande passante EIP (Mbit/s)

  APP_URL: string;
  GRAFANA_URL?: string;
  MAIL_ENABLED: string; // "true" | "false"
  SCHEDULED_STOP: string; // "true" | "false" — extinction nocturne
  IDLE_STOP?: string; // "true" | "false" — arrêt sur inactivité (CES)
  IDLE_STOP_HOURS?: string; // heures d'inactivité avant arrêt (déf. 3)
  HARDENING?: string; // "true" | "false" — durcissement in-VM
  SENTRY_DSN?: string;
  EMAILJS_PUBLIC_KEY: string;
  EMAILJS_SERVICE_ID: string;
  EMAILJS_TEMPLATE_ID: string;

  // ---- Secrets (wrangler secret put …) ------------------------------------
  ENTRA_CLIENT_SECRET: string;
  SESSION_SECRET: string; // signature des sessions + états OIDC
  // Chiffrement au repos (clés SSH, mots de passe Windows). SÉPARÉ de SESSION_SECRET
  // (dette AWS corrigée : là-bas la rotation de SESSION_SECRET cassait tout le chiffré).
  // Repli sur SESSION_SECRET si absent, pour la parité. Voir ADR 0003.
  DATA_ENCRYPTION_KEY?: string;
  HUAWEI_ACCESS_KEY: string; // AK de l'utilisateur IAM
  HUAWEI_SECRET_KEY: string; // SK
  EMAILJS_PRIVATE_KEY: string;
  GRAFANA_TOKEN?: string;
}

export interface SessionUser {
  email: string;
  name: string;
  role: 'member' | 'formateur' | 'admin';
}

export interface VmRequestRow {
  id: number;
  user_email: string;
  name: string | null;
  purpose: string;
  preset: string; // id de gabarit de performance
  storage: string | null;
  os: string | null;
  region: string;
  status: string;
  course: string | null;
  course_ready_at: string | null;
  group_id: string | null;
  group_name: string | null;
  snapshot_on_delete: number;
  restore_snapshot_id: number | null;
  admin_note: string | null;
  decided_by: string | null;
  created_at: string;
  decided_at: string | null;
  start_date: string | null;
  end_date: string | null;
  expired_at: string | null;
  ext_requested_end: string | null;
  ext_requested_at: string | null;
  // planning auto start/stop (Europe/Zurich)
  schedule_enabled?: number;
  schedule_start?: string | null;
  schedule_stop?: string | null;
  schedule_days?: string | null;
  schedule_paused?: number;
  // colonnes jointes depuis vms (nullable)
  public_ip?: string | null;
  ssh_key_name?: string | null;
  ssh_user?: string | null;
  vm_state?: string | null;
  connect_method?: string | null;
}
