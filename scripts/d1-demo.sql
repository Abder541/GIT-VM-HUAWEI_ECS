-- VALIDATION machine à états D1 — données SYNTHÉTIQUES, base LOCALE uniquement.
-- Couvre tous les cas du cycle de vie + les sélections de garde-fous du réconciliateur.
-- Aucune ressource Huawei : on ne fait qu'écrire/lire la D1.

DELETE FROM vms;
DELETE FROM vm_requests;
DELETE FROM users;

INSERT INTO users (email, name, role) VALUES
  ('admin@satom.ch',   'Admin Démo',     'admin'),
  ('member@satom.ch',  'Membre Démo',    'member'),
  ('trainer@satom.ch', 'Formateur Démo', 'formateur');

-- #1 — pending (en attente de validation admin)
INSERT INTO vm_requests (id,user_email,name,purpose,preset,storage,os,region,status,end_date)
 VALUES (1,'member@satom.ch','demo1','cours python','small','s40','ubuntu2404','eu-west-101','pending', datetime('now','+7 days'));

-- #2 — rejected (refusée par l'admin)
INSERT INTO vm_requests (id,user_email,name,purpose,preset,storage,os,region,status,admin_note,decided_by,decided_at,end_date)
 VALUES (2,'member@satom.ch','demo2','test','small','s40','ubuntu2404','eu-west-101','rejected','hors périmètre','admin@satom.ch',datetime('now'), datetime('now','+7 days'));

-- #3 — active, running, échéance FUTURE (VM normale)
INSERT INTO vm_requests (id,user_email,name,purpose,preset,storage,os,region,status,end_date)
 VALUES (3,'member@satom.ch','demo3','web','small','s40','ubuntu2404','eu-west-101','active', datetime('now','+30 days'));
INSERT INTO vms (request_id,server_id,state,ssh_key_name,ssh_user,connect_method)
 VALUES (3,'srv-0003','running','vm-portal-req-3','root','ssh');

-- #4 — active, échéance PASSÉE → candidate EXPIRY (le réconciliateur la terminerait)
INSERT INTO vm_requests (id,user_email,name,purpose,preset,storage,os,region,status,end_date)
 VALUES (4,'member@satom.ch','demo4','old','small','s40','ubuntu2404','eu-west-101','active', datetime('now','-1 hour'));
INSERT INTO vms (request_id,server_id,state,ssh_key_name,ssh_user,connect_method)
 VALUES (4,'srv-0004','running','vm-portal-req-4','root','ssh');

-- #5 — active avec expired_at posé → bucket "expired" DÉRIVÉ (statut reste 'active')
INSERT INTO vm_requests (id,user_email,name,purpose,preset,storage,os,region,status,end_date,expired_at)
 VALUES (5,'member@satom.ch','demo5','done','small','s40','ubuntu2404','eu-west-101','active', datetime('now','-2 days'), datetime('now','-1 day'));

-- #6 — active, planning activé (lun-ven 08:00→18:00) → candidate SCHEDULE
INSERT INTO vm_requests (id,user_email,name,purpose,preset,storage,os,region,status,end_date,schedule_enabled,schedule_start,schedule_stop,schedule_days)
 VALUES (6,'member@satom.ch','demo6','cours','small','s40','ubuntu2404','eu-west-101','active', datetime('now','+30 days'),1,'08:00','18:00','1,2,3,4,5');
INSERT INTO vms (request_id,server_id,state,ssh_key_name,ssh_user,connect_method)
 VALUES (6,'srv-0006','running','vm-portal-req-6','root','ssh');

-- #7 — provisioning, job non encore résolu (server_id NULL) → resolveLaunch au tick
INSERT INTO vm_requests (id,user_email,name,purpose,preset,storage,os,region,status,end_date)
 VALUES (7,'member@satom.ch','demo7','new','small','s40','ubuntu2404','eu-west-101','provisioning', datetime('now','+30 days'));
INSERT INTO vms (request_id,provider_job_id,state,ssh_key_name,ssh_user,connect_method)
 VALUES (7,'job-aaaa-7','pending','vm-portal-req-7','root','ssh');
