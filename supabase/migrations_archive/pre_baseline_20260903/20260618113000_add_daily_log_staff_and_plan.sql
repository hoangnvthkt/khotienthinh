-- Add staff_ids and next_day_plan to daily_logs table
ALTER TABLE daily_logs 
ADD COLUMN IF NOT EXISTS staff_ids TEXT[] DEFAULT '{}',
ADD COLUMN IF NOT EXISTS next_day_plan TEXT;
