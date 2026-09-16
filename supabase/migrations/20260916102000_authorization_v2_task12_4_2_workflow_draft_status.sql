-- Add a real draft lifecycle state. Runtime commands are installed by the
-- following migration after this enum value is committed and safe to use.
alter type public.workflow_instance_status add value if not exists 'DRAFT' before 'RUNNING';
