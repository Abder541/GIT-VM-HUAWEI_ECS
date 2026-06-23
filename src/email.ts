import type { Env } from './types';
import { audit } from './db';

// Email via EmailJS REST API (server-side / non-browser).
// EmailJS HTML-escapes variable values, so the pretty layout lives in the
// EmailJS template (static HTML). We only send PLAIN TEXT here:
//   Subject  = {{subject}}
//   To Email = {{to_email}}
//   Content  = branded HTML using {{title}} and {{message}}
//              ({{message}} rendered in a container with white-space:pre-line,
//               so "\n" in the text becomes line breaks)

interface Mail {
  to: string;
  subject: string;
  title: string;
  message: string; // plain text, may contain \n
}

async function sendMail(env: Env, mail: Mail): Promise<void> {
  const configured = env.EMAILJS_SERVICE_ID && env.EMAILJS_TEMPLATE_ID && env.EMAILJS_PUBLIC_KEY;
  if (env.MAIL_ENABLED !== 'true' || !configured) {
    await audit(env, 'system', 'mail.skipped', mail.to, mail.subject);
    return;
  }
  const res = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      service_id: env.EMAILJS_SERVICE_ID,
      template_id: env.EMAILJS_TEMPLATE_ID,
      user_id: env.EMAILJS_PUBLIC_KEY,
      accessToken: env.EMAILJS_PRIVATE_KEY,
      template_params: {
        to_email: mail.to,
        subject: mail.subject,
        title: mail.title,
        message: mail.message,
      },
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    await audit(env, 'system', 'mail.failed', mail.to, `${res.status} ${body}`.slice(0, 200));
    return;
  }
  await audit(env, 'system', 'mail.sent', mail.to, mail.subject);
}

const ADMIN_RECIPIENTS = (env: Env) =>
  env.ADMIN_EMAILS.split(',').map((e) => e.trim()).filter(Boolean);

export async function notifyAdminsNewRequest(env: Env, reqId: number, userEmail: string, preset: string) {
  const message =
    `${userEmail} a soumis une demande de VM.\n\n` +
    `Type : ${preset}\nDemande : #${reqId}\n\n` +
    `Validation requise dans le dashboard admin.`;
  for (const to of ADMIN_RECIPIENTS(env)) {
    await sendMail(env, { to, subject: `Nouvelle demande VM #${reqId}`, title: `Nouvelle demande VM #${reqId}`, message });
  }
}

export async function notifyUserApproved(env: Env, to: string, reqId: number) {
  const message =
    `Bonne nouvelle — ta demande #${reqId} a été approuvée.\n\n` +
    `Ta VM est en cours de création. Tu recevras un second email avec l'adresse IP ` +
    `et les instructions de connexion dès qu'elle est prête (quelques instants).`;
  await sendMail(env, { to, subject: `Demande #${reqId} approuvée`, title: 'Demande approuvée ✅', message });
}

export async function notifyUserRejected(env: Env, to: string, reqId: number, note: string) {
  const message =
    `Ta demande #${reqId} n'a pas été retenue.\n\n` +
    `Motif : ${note || 'non précisé'}\n\n` +
    `Tu peux soumettre une nouvelle demande depuis le portail.`;
  await sendMail(env, { to, subject: `Demande #${reqId} refusée`, title: 'Demande refusée', message });
}

export async function notifyUserExpiring(env: Env, to: string, reqId: number, endDate: string) {
  const when = new Date(endDate).toLocaleString('fr-CH', { dateStyle: 'long', timeStyle: 'short' });
  const message =
    `Rappel — ta VM #${reqId} arrive à échéance le ${when}.\n\n` +
    `⚠️ À cette date, elle sera automatiquement SUPPRIMÉE : l'instance et le disque seront ` +
    `définitivement détruits et les données perdues. **Sauvegarde ton travail dès maintenant.** ` +
    `Contacte un administrateur si tu as besoin d'une prolongation.`;
  await sendMail(env, { to, subject: `VM #${reqId} — échéance proche`, title: 'Échéance proche ⏰', message });
}

export async function notifyUserExpired(env: Env, to: string, reqId: number) {
  const message =
    `Ta VM #${reqId} a atteint sa date de fin et a été automatiquement SUPPRIMÉE.\n\n` +
    `L'instance et son disque ont été détruits définitivement. Pour repartir, soumets une ` +
    `nouvelle demande depuis le portail.`;
  await sendMail(env, { to, subject: `VM #${reqId} expirée (supprimée)`, title: 'VM expirée — supprimée 🗑️', message });
}

export async function notifyAdminsExtension(env: Env, reqId: number, userEmail: string, until: string) {
  const when = new Date(until).toLocaleString('fr-CH', { dateStyle: 'long', timeStyle: 'short' });
  const message =
    `${userEmail} demande à prolonger la VM #${reqId} jusqu'au ${when}.\n\n` +
    `Valide ou refuse depuis la console d'administration.`;
  for (const to of ADMIN_RECIPIENTS(env)) {
    await sendMail(env, { to, subject: `Prolongation demandée — VM #${reqId}`, title: 'Demande de prolongation ⏳', message });
  }
}

export async function notifyUserExtensionApproved(env: Env, to: string, reqId: number, until: string) {
  const when = new Date(until).toLocaleString('fr-CH', { dateStyle: 'long', timeStyle: 'short' });
  const message =
    `Bonne nouvelle — la prolongation de ta VM #${reqId} est accordée.\n\n` +
    `Nouvelle date de fin : ${when}.`;
  await sendMail(env, { to, subject: `VM #${reqId} prolongée`, title: 'Prolongation accordée ✅', message });
}

export async function notifyUserExtensionRejected(env: Env, to: string, reqId: number) {
  const message =
    `Ta demande de prolongation pour la VM #${reqId} n'a pas été retenue.\n\n` +
    `La date de fin reste inchangée. Pense à sauvegarder ton travail avant l'échéance.`;
  await sendMail(env, { to, subject: `Prolongation refusée — VM #${reqId}`, title: 'Prolongation refusée', message });
}

export async function notifyUserReady(
  env: Env,
  to: string,
  reqId: number,
  ip: string,
  loginUser = 'ubuntu',
  connect: 'ssh' | 'rdp' = 'ssh'
) {
  const message =
    connect === 'rdp'
      ? `Ta VM Windows #${reqId} est active et prête à l'emploi. 🎉\n\n` +
        `IP publique : ${ip}\n` +
        `Connexion Bureau à distance (RDP) :\n` +
        `Utilisateur : ${loginUser}\n` +
        `Mot de passe : récupère-le depuis le portail (il n'est visible que par toi).\n\n` +
        `Ouvre le portail pour les instructions MobaXterm / Bureau à distance.`
      : `Ta VM #${reqId} est active et prête à l'emploi. 🎉\n\n` +
        `IP publique : ${ip}\n` +
        `Connexion SSH :\n` +
        `ssh -i vm-portal-req-${reqId}.pem ${loginUser}@${ip}\n\n` +
        `Télécharge d'abord ta clé privée depuis le portail (bouton ci-dessous). ` +
        `La clé n'est accessible que par toi.`;
  await sendMail(env, { to, subject: `VM #${reqId} prête`, title: 'Ta VM est prête 🚀', message });
}
