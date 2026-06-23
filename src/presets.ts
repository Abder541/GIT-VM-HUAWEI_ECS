// Une demande de VM = performance (flavor) × stockage (EVS) × OS (image IMS).
// Catalogue Huawei Cloud EU, région eu-west-101. Données issues de la découverte
// réelle (scripts/huawei-discover.mjs). Prix EUR approximatifs (pay-as-you-go).

export interface PerfPreset {
  id: string;
  label: string;
  flavor: string; // ECS flavor (ex. s6.large.2) — ex-instanceType AWS
  vcpu: number;
  ramGb: number;
  hourlyEur: number;
  description?: string;
  recommended?: boolean;
  /** Conservé pour résoudre d'anciennes demandes mais masqué du sélecteur. */
  hidden?: boolean;
}
export interface StoragePreset {
  id: string;
  label: string;
  sizeGb: number;
  description?: string;
  recommended?: boolean;
  hidden?: boolean;
}
export interface OsPreset {
  id: string;
  label: string;
  /** Famille de distribution — pilote l'icône/couleur du sélecteur. */
  family: 'ubuntu' | 'debian' | 'amazon' | 'rocky' | 'alma' | 'windows';
  image: string; // image_id IMS — ex-ami AWS
  /** Utilisateur de connexion SSH (ou RDP pour Windows). */
  sshUser: string;
  connect: 'ssh' | 'rdp';
  description?: string;
  recommended?: boolean;
  /** Disque racine minimal pour cet OS (Huawei : ≥ 40 Go constaté). */
  minStorageGb?: number;
  hidden?: boolean;
}

// Flavors vérifiés disponibles sur eu-west-101 (série s6, usage général, x86_64).
export const PERF: Record<string, PerfPreset> = {
  micro: { id: 'micro', label: 'Micro', flavor: 's6.medium.2', vcpu: 1, ramGb: 2, hourlyEur: 0.018, description: 'Tests légers, scripts, apprentissage.' },
  small: { id: 'small', label: 'Small', flavor: 's6.large.2', vcpu: 2, ramGb: 4, hourlyEur: 0.036, description: 'Dev, petits services, la plupart des cours.', recommended: true },
  flex: { id: 'flex', label: 'Flex', flavor: 's6.large.4', vcpu: 2, ramGb: 8, hourlyEur: 0.05, description: '8 Go — plus confortable (conteneurs, IDE).' },
  perf: { id: 'perf', label: 'Performance', flavor: 's6.xlarge.2', vcpu: 4, ramGb: 8, hourlyEur: 0.072, description: '4 vCPU — charges plus lourdes.' },
};

// EVS (GPSSD). Plancher 40 Go : les images Huawei (Ubuntu 24.04…) imposent mindisk = 40.
export const STORAGE: Record<string, StoragePreset> = {
  s40: { id: 's40', label: '40 Go SSD', sizeGb: 40, description: 'Minimum (imposé par les images), suffisant pour un OS + outils.', recommended: true },
  s80: { id: 's80', label: '80 Go SSD', sizeGb: 80, description: 'Confortable pour projets et données.' },
  s160: { id: 's160', label: '160 Go SSD', sizeGb: 160, description: 'Gros besoins (datasets, conteneurs multiples).' },
};

// Images IMS « gold » vérifiées (image_id concrets eu-west-101, via huawei-discover.mjs).
// ⚠️ Huawei ECS Linux : connexion par défaut en `root` via la clé (à confirmer par SSH réel).
// Windows absent du catalogue gold EU → à sourcer (Marketplace/BYOL) avant réactivation RDP.
export const OS: Record<string, OsPreset> = {
  ubuntu2404: { id: 'ubuntu2404', label: 'Ubuntu 24.04 LTS', family: 'ubuntu', image: '188483c4-c66a-4559-83e6-e7f6591cdab0', sshUser: 'root', connect: 'ssh', minStorageGb: 40, description: 'La distribution Linux la plus répandue. Idéale pour débuter.', recommended: true },
  debian12: { id: 'debian12', label: 'Debian 12 (Bookworm)', family: 'debian', image: '1479cc34-8bc9-4bb0-9fe3-7530c39cd849', sshUser: 'root', connect: 'ssh', minStorageGb: 40, description: 'Stable et légère, la référence des serveurs.' },
  ubuntu2204: { id: 'ubuntu2204', label: 'Ubuntu 22.04 LTS', family: 'ubuntu', image: 'd57f79e5-a9c5-4592-8270-a822e41ad6f4', sshUser: 'root', connect: 'ssh', minStorageGb: 40, description: 'LTS précédente, éprouvée.' },
};

// Bundles d'outils par cours, préinstallés via cloud-init au premier démarrage.
// MULTI-DISTRO : le header détecte apt / dnf / yum et expose `pm` (installe chaque
// paquet individuellement, tolérant). Outils cloud/devops via installeurs officiels.
export interface CoursePreset {
  id: string;
  label: string;
  description: string;
  tools: string[];
  install: string;
}

export const COURSE_SCRIPT_HEADER = [
  '#!/bin/bash',
  'set -x',
  'if command -v apt-get >/dev/null 2>&1; then',
  '  export DEBIAN_FRONTEND=noninteractive; apt-get update -y || true',
  '  pm() { for p in "$@"; do apt-get install -y "$p" || true; done; }',
  'elif command -v dnf >/dev/null 2>&1; then',
  '  dnf install -y dnf-plugins-core || true',
  '  pm() { for p in "$@"; do dnf install -y "$p" || true; done; }',
  'elif command -v yum >/dev/null 2>&1; then',
  '  pm() { for p in "$@"; do yum install -y "$p" || true; done; }',
  'else',
  '  pm() { :; }',
  'fi',
].join('\n');

const DOCKER = 'curl -fsSL https://get.docker.com | sh || true';
const KUBECTL = 'curl -LO "https://dl.k8s.io/release/$(curl -L -s https://dl.k8s.io/release/stable.txt)/bin/linux/amd64/kubectl" && install -m 0755 kubectl /usr/local/bin/kubectl || true';
const HELM = 'curl -fsSL https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 | bash || true';
const MINIKUBE = 'curl -Lo /usr/local/bin/minikube https://storage.googleapis.com/minikube/releases/latest/minikube-linux-amd64 && chmod +x /usr/local/bin/minikube || true';
const TERRAFORM = 'pm unzip; curl -fsSL https://releases.hashicorp.com/terraform/1.9.8/terraform_1.9.8_linux_amd64.zip -o /tmp/tf.zip && unzip -o /tmp/tf.zip -d /usr/local/bin/ || true';
const AWSCLI = 'pm unzip; curl -s "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o /tmp/aws.zip && unzip -q /tmp/aws.zip -d /tmp && /tmp/aws/install || true';
const GCLOUD = 'curl -sSL https://sdk.cloud.google.com | bash || true';
const NODE = 'if command -v apt-get >/dev/null 2>&1; then curl -fsSL https://deb.nodesource.com/setup_lts.x | bash - && apt-get install -y nodejs; else curl -fsSL https://rpm.nodesource.com/setup_lts.x | bash - && (dnf install -y nodejs || yum install -y nodejs); fi || true';
const AZURE = 'if command -v apt-get >/dev/null 2>&1; then curl -sL https://aka.ms/InstallAzureCLIDeb | bash; else rpm --import https://packages.microsoft.com/keys/microsoft.asc && dnf install -y https://packages.microsoft.com/config/rhel/9/packages-microsoft-prod.rpm && dnf install -y azure-cli; fi || true';
const pip = (pkgs: string) => `python3 -m pip install --break-system-packages ${pkgs} 2>/dev/null || python3 -m pip install ${pkgs} || true`;

export const COURSES: Record<string, CoursePreset> = {
  cloud: {
    id: 'cloud',
    label: 'Cloud & DevOps',
    description: 'Azure CLI, AWS CLI, Google Cloud CLI, Terraform, kubectl, Docker, Helm, Ansible.',
    tools: ['Azure CLI', 'AWS CLI', 'gcloud', 'Terraform', 'kubectl', 'Docker', 'Helm', 'Ansible'],
    install: [
      'pm git curl unzip ca-certificates python3 python3-pip',
      DOCKER, AZURE, AWSCLI, GCLOUD, TERRAFORM, KUBECTL, HELM,
      `pm ansible; command -v ansible >/dev/null 2>&1 || ${pip('ansible')}`,
    ].join('\n'),
  },
  web: {
    id: 'web',
    label: 'Développement Web',
    description: 'Node.js LTS, npm, Git, Nginx, Python 3, build-essential.',
    tools: ['Node.js LTS', 'npm', 'Git', 'Nginx', 'Python 3', 'build-essential'],
    install: ['pm git nginx python3 python3-pip build-essential gcc gcc-c++ make', NODE].join('\n'),
  },
  data: {
    id: 'data',
    label: 'Data Science & IA',
    description: 'Python 3, Jupyter, NumPy, pandas, matplotlib, scikit-learn, R.',
    tools: ['Python 3', 'Jupyter', 'NumPy', 'pandas', 'matplotlib', 'scikit-learn', 'R'],
    install: ['pm python3 python3-pip python3-venv r-base R', pip('jupyter numpy pandas matplotlib scikit-learn seaborn')].join('\n'),
  },
  containers: {
    id: 'containers',
    label: 'Conteneurs & Kubernetes',
    description: 'Docker, kubectl, minikube, Helm, k9s.',
    tools: ['Docker', 'kubectl', 'minikube', 'Helm', 'k9s'],
    install: [DOCKER, KUBECTL, MINIKUBE, HELM].join('\n'),
  },
  cyber: {
    id: 'cyber',
    label: 'Cybersécurité',
    description: 'nmap, tshark, hydra, john, tcpdump, nikto, net-tools, whois, dnsutils.',
    tools: ['nmap', 'tshark', 'hydra', 'john', 'tcpdump', 'nikto', 'net-tools', 'whois'],
    install: ['pm nmap tshark wireshark-cli hydra john tcpdump nikto net-tools whois dnsutils bind-utils'].join('\n'),
  },
  db: {
    id: 'db',
    label: 'Bases de données',
    description: 'PostgreSQL, MariaDB (MySQL), Redis, SQLite.',
    tools: ['PostgreSQL', 'MariaDB', 'Redis', 'SQLite'],
    install: ['pm postgresql postgresql-server mariadb-server mariadb redis redis-server sqlite sqlite3'].join('\n'),
  },
  sysadmin: {
    id: 'sysadmin',
    label: 'Système & Réseau',
    description: 'net-tools, tcpdump, nmap, htop, tmux, rsync, iperf3, traceroute, vim.',
    tools: ['net-tools', 'tcpdump', 'nmap', 'htop', 'tmux', 'rsync', 'iperf3', 'traceroute'],
    install: ['pm net-tools tcpdump nmap htop tmux rsync openssh-client openssh-clients iperf3 traceroute vim'].join('\n'),
  },
  cpp: {
    id: 'cpp',
    label: 'Programmation C / C++',
    description: 'gcc, g++, gdb, make, cmake, valgrind, build-essential.',
    tools: ['gcc', 'g++', 'gdb', 'make', 'cmake', 'valgrind'],
    install: ['pm build-essential gcc gcc-c++ make gdb cmake valgrind'].join('\n'),
  },
  java: {
    id: 'java',
    label: 'Java',
    description: 'OpenJDK 17, Maven, Gradle.',
    tools: ['OpenJDK 17', 'Maven', 'Gradle'],
    install: ['pm openjdk-17-jdk java-17-openjdk java-17-openjdk-devel maven gradle'].join('\n'),
  },
  python: {
    id: 'python',
    label: 'Python',
    description: 'Python 3, pip, venv, pipx, IPython, Jupyter.',
    tools: ['Python 3', 'pip', 'venv', 'pipx', 'IPython', 'Jupyter'],
    install: ['pm python3 python3-pip python3-venv pipx', pip('ipython jupyter')].join('\n'),
  },
};

export const isValidCourse = (id: string) => id === '' || Object.prototype.hasOwnProperty.call(COURSES, id);

export function buildCourseUserData(courseId: string | null | undefined): string | undefined {
  if (!courseId) return undefined;
  const c = COURSES[courseId];
  if (!c) return undefined;
  return `${COURSE_SCRIPT_HEADER}\n${c.install}\n`;
}

// Mapping Chocolatey par cours (Windows). Conservé pour réactivation quand une image
// Windows sera disponible sur le site EU.
const COURSE_WIN: Record<string, string> = {
  cloud: 'git azure-cli awscli gcloudsdk terraform kubernetes-cli kubernetes-helm docker-cli docker-engine',
  web: 'git nodejs-lts nginx python',
  data: 'python r.project',
  containers: 'docker-cli docker-engine kubernetes-cli minikube kubernetes-helm',
  cyber: 'nmap wireshark',
  db: 'postgresql sqlite',
  sysadmin: 'nmap wireshark putty sysinternals',
  cpp: 'mingw cmake',
  java: 'temurin17 maven gradle',
  python: 'python',
};

export function buildWindowsCourseInstall(courseId: string | null | undefined): string | undefined {
  const pkgs = courseId ? COURSE_WIN[courseId] : undefined;
  if (!pkgs) return undefined;
  return [
    'Set-ExecutionPolicy Bypass -Scope Process -Force',
    '[System.Net.ServicePointManager]::SecurityProtocol = [System.Net.ServicePointManager]::SecurityProtocol -bor 3072',
    "iex ((New-Object System.Net.WebClient).DownloadString('https://community.chocolatey.org/install.ps1'))",
    `choco install -y --no-progress ${pkgs}`,
  ].join('\n');
}

export const STORAGE_EUR_GB_MONTH = 0.1; // GPSSD eu-west-101 (approx)
const HOURS_PER_MONTH = 730;

export const isValidPerf = (id: string) => Object.prototype.hasOwnProperty.call(PERF, id);
export const isValidStorage = (id: string) => Object.prototype.hasOwnProperty.call(STORAGE, id);
export const isValidOs = (id: string) => Object.prototype.hasOwnProperty.call(OS, id);

// Coût mensuel approximatif si la VM tourne 24/7 (hors EIP).
export function estimateMonthlyEur(perfId: string, storageId: string): number {
  const p = PERF[perfId];
  const s = STORAGE[storageId];
  if (!p || !s) return 0;
  return p.hourlyEur * HOURS_PER_MONTH + s.sizeGb * STORAGE_EUR_GB_MONTH;
}
