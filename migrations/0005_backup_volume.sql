-- 0005 — Sauvegarde à la suppression (Option A). Un snapshot EVS meurt avec son disque
-- (cf. limitation Huawei) → on conserve plutôt le DISQUE (volume EVS) lui-même, qui survit
-- et reste bootable. Ce volume conservé permet de restaurer la VM en bootant dessus (Nova
-- block_device_mapping_v2). Stocké dans la table snapshots (réutilisée) via cette colonne :
-- une ligne avec backup_volume_id non nul = une SAUVEGARDE (pas un snapshot EVS).
ALTER TABLE snapshots ADD COLUMN backup_volume_id TEXT;
