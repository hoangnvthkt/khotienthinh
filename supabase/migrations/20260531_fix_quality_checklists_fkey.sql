-- =====================================================================
-- Fix Quality Checklists Foreign Key constraint
-- Drop obsolete quality_checklist_templates reference and map to inspection_templates
-- =====================================================================

-- 1. Drop old foreign key constraint
ALTER TABLE quality_checklists DROP CONSTRAINT IF EXISTS quality_checklists_template_id_fkey;

-- 2. Add new foreign key constraint pointing to the active inspection_templates table
ALTER TABLE quality_checklists 
  ADD CONSTRAINT quality_checklists_template_id_fkey 
  FOREIGN KEY (template_id) 
  REFERENCES inspection_templates(id) 
  ON DELETE SET NULL;

-- 3. Drop the old unused quality_checklist_templates table to clean up database schema
DROP TABLE IF EXISTS quality_checklist_templates CASCADE;
