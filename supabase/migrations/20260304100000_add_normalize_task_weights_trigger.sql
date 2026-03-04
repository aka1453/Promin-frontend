-- ============================================================================
-- Add missing trigger for normalize_task_weights on tasks table
-- ============================================================================
-- The normalize_task_weights() function already exists (from remote_schema)
-- but was never wired to a trigger on the tasks table. This means
-- adding/removing/reweighting tasks within a milestone does NOT
-- auto-normalize weights — unlike deliverables and milestones which
-- both have their normalization triggers.
-- ============================================================================

-- Fire on INSERT, UPDATE of weight, and DELETE
CREATE TRIGGER normalize_task_weights_trigger
  AFTER INSERT OR DELETE OR UPDATE OF weight
  ON public.tasks
  FOR EACH ROW
  EXECUTE FUNCTION public.normalize_task_weights();
