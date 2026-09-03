-- Migration: Create workflow_step_tasks table for step checklist items in Module Quy trình
CREATE TABLE IF NOT EXISTS public.workflow_step_tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    instance_id UUID NOT NULL REFERENCES public.workflow_instances(id) ON DELETE CASCADE,
    node_id TEXT NOT NULL,
    title TEXT NOT NULL,
    is_completed BOOLEAN NOT NULL DEFAULT FALSE,
    completed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    completed_at TIMESTAMPTZ,
    attachments JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_by UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_workflow_step_tasks_instance_id ON public.workflow_step_tasks(instance_id);
CREATE INDEX IF NOT EXISTS idx_workflow_step_tasks_node_id ON public.workflow_step_tasks(instance_id, node_id);

-- Enable RLS
ALTER TABLE public.workflow_step_tasks ENABLE ROW LEVEL SECURITY;

-- Permissive policies for workflow step tasks (aligned with workflow_instances access)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE tablename = 'workflow_step_tasks' AND policyname = 'Allow read workflow_step_tasks'
    ) THEN
        CREATE POLICY "Allow read workflow_step_tasks" ON public.workflow_step_tasks FOR SELECT USING (true);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE tablename = 'workflow_step_tasks' AND policyname = 'Allow insert workflow_step_tasks'
    ) THEN
        CREATE POLICY "Allow insert workflow_step_tasks" ON public.workflow_step_tasks FOR INSERT WITH CHECK (true);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE tablename = 'workflow_step_tasks' AND policyname = 'Allow update workflow_step_tasks'
    ) THEN
        CREATE POLICY "Allow update workflow_step_tasks" ON public.workflow_step_tasks FOR UPDATE USING (true);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE tablename = 'workflow_step_tasks' AND policyname = 'Allow delete workflow_step_tasks'
    ) THEN
        CREATE POLICY "Allow delete workflow_step_tasks" ON public.workflow_step_tasks FOR DELETE USING (true);
    END IF;
END $$;
