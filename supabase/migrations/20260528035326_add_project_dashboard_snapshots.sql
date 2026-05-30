-- Create project_dashboard_snapshots table to persist compiled dashboard metrics
CREATE TABLE IF NOT EXISTS public.project_dashboard_snapshots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    scope_key VARCHAR(255) UNIQUE NOT NULL,
    project_id VARCHAR(255),
    construction_site_id VARCHAR(255),
    metrics JSONB NOT NULL,
    calculated_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now())
);

-- Enable RLS
ALTER TABLE public.project_dashboard_snapshots ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if any
DROP POLICY IF EXISTS "Allow authenticated users to read snapshots" ON public.project_dashboard_snapshots;
DROP POLICY IF EXISTS "Allow authenticated users to insert/update snapshots" ON public.project_dashboard_snapshots;

-- Create policy to allow all authenticated users to read snapshots
CREATE POLICY "Allow authenticated users to read snapshots"
ON public.project_dashboard_snapshots
FOR SELECT
TO authenticated
USING (true);

-- Create policy to allow authenticated users to upsert snapshots
CREATE POLICY "Allow authenticated users to insert/update snapshots"
ON public.project_dashboard_snapshots
FOR ALL
TO authenticated
USING (true)
WITH CHECK (true);

-- Grant privileges
GRANT ALL ON public.project_dashboard_snapshots TO authenticated;
GRANT ALL ON public.project_dashboard_snapshots TO service_role;
