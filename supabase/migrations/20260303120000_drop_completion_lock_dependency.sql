-- Drop the completion lock on task_dependencies.
-- This allows adding/removing dependencies even when a task is completed.
-- The other completion locks (on tasks, milestones, deliverables) remain intact.

DROP TRIGGER IF EXISTS completion_lock_dependency ON public.task_dependencies;
DROP FUNCTION IF EXISTS public.completion_lock_dependency();
