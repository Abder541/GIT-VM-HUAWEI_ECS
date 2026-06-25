-- 0003_rollback.sql — Restauration EN PLACE via rollback de snapshot EVS.
--
-- ADDITIF STRICT. Ces colonnes restent NULL pour TOUTES les VM normales et pour le flux
-- de création standard : zéro régression possible. Elles pilotent uniquement la machine
-- à états du rollback en place — stop VM → rollbackSnapshot → attente volume 'available'
-- → start VM — conduite par le réconciliateur, isolée du reste du parcours.
--
-- Distinct du flux 0002 (restore_*, « nouvelle VM depuis snapshot » via IMS), bloqué au
-- niveau du compte (real-name auth / IMG.0026) et donc neutralisé côté entrée.

ALTER TABLE vms ADD COLUMN rollback_step        TEXT;  -- NULL=normal | 'stopping' | 'rollingback' | 'starting'
ALTER TABLE vms ADD COLUMN rollback_snapshot_id TEXT;  -- snapshot EVS cible de la restauration en place
ALTER TABLE vms ADD COLUMN rollback_volume_id   TEXT;  -- volume racine en cours de rollback (suivi du statut EVS)
