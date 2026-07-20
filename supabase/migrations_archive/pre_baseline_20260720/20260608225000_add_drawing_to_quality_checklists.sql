-- Migration: Add drawing and template snapshot enhancements to quality_checklists
ALTER TABLE quality_checklists ADD COLUMN IF NOT EXISTS drawing_url TEXT;
ALTER TABLE quality_checklists ADD COLUMN IF NOT EXISTS drawing_markers JSONB DEFAULT '[]';
ALTER TABLE quality_checklists ADD COLUMN IF NOT EXISTS target_completion_date DATE;
ALTER TABLE quality_checklists ADD COLUMN IF NOT EXISTS signers_data JSONB DEFAULT '[]';
ALTER TABLE quality_checklists ADD COLUMN IF NOT EXISTS standard_reference TEXT;
