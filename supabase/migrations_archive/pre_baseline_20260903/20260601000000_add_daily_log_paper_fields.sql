-- 2026-06-01: Add daily log paper checklist fields to daily_logs table
ALTER TABLE public.daily_logs
  ADD COLUMN IF NOT EXISTS acceptance_description TEXT,
  
  ADD COLUMN IF NOT EXISTS work_safety_ok BOOLEAN DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS env_hygiene_ok BOOLEAN DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS traffic_safety_ok BOOLEAN DEFAULT TRUE,
  
  ADD COLUMN IF NOT EXISTS supervisor_construction_eval TEXT,
  ADD COLUMN IF NOT EXISTS supervisor_acceptance_eval TEXT,
  
  ADD COLUMN IF NOT EXISTS supervisor_safety_ok BOOLEAN DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS supervisor_hygiene_ok BOOLEAN DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS supervisor_traffic_ok BOOLEAN DEFAULT TRUE;
