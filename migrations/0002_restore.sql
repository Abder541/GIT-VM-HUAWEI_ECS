-- 0002_restore.sql — Suivi de la restauration depuis snapshot (IMS).
--
-- ADDITIF STRICT. Aucune modification du flux existant : ces colonnes restent NULL
-- pour toutes les VM normales, et aucun code ne les lit/écrit encore à ce stade
-- (les blocs « méthodes provider » puis « réconciliateur » viendront ensuite).
-- Zéro régression possible sur le parcours VM actuel.

ALTER TABLE vms ADD COLUMN restore_step      TEXT;  -- NULL=normal | 'volume' | 'image' | 'launch'
ALTER TABLE vms ADD COLUMN restore_volume_id TEXT;  -- volume EVS transitoire (supprimé après l'image)
ALTER TABLE vms ADD COLUMN restore_image_id  TEXT;  -- image IMS transitoire (supprimée après le launch)
