-- Migration: Rename subtasks → deliverables (Phase B: Complete Rename)
-- Date: 2026-01-18
-- Purpose: Complete the table rename after frontend is fully updated
-- PREREQUISITE: Phase A migration applied, frontend updated to use "deliverables"

-- Step 1: Drop the INSTEAD OF triggers
DROP TRIGGER IF EXISTS deliverables_delete_trigger ON deliverables;
DROP TRIGGER IF EXISTS deliverables_update_trigger ON deliverables;
DROP TRIGGER IF EXISTS deliverables_insert_trigger ON deliverables;

-- Step 2: Drop the trigger functions
DROP FUNCTION IF EXISTS deliverables_delete_trigger_fn();
DROP FUNCTION IF EXISTS deliverables_update_trigger_fn();
DROP FUNCTION IF EXISTS deliverables_insert_trigger_fn();

-- Step 3: Drop the alias view
DROP VIEW IF EXISTS deliverables;

-- Step 4: Rename the actual table
ALTER TABLE subtasks RENAME TO deliverables;

-- Step 5: Rename the ID sequence
ALTER SEQUENCE subtasks_id_seq RENAME TO deliverables_id_seq;

-- Step 6: Rename primary key constraint
ALTER TABLE deliverables 
  RENAME CONSTRAINT subtasks_pkey TO deliverables_pkey;

-- Step 7: Rename foreign key constraint
ALTER TABLE deliverables 
  RENAME CONSTRAINT subtasks_task_id_fkey TO deliverables_task_id_fkey;

-- Step 8: Rename check constraints
ALTER TABLE deliverables
  RENAME CONSTRAINT subtasks_planned_dates_logical TO deliverables_planned_dates_logical;

ALTER TABLE deliverables
  RENAME CONSTRAINT subtasks_priority_check TO deliverables_priority_check;

ALTER TABLE deliverables
  RENAME CONSTRAINT subtasks_weight_non_negative TO deliverables_weight_non_negative;

-- Step 9: Rename indexes
ALTER INDEX IF EXISTS subtasks_pkey RENAME TO deliverables_pkey;
ALTER INDEX IF EXISTS subtasks_task_id_idx RENAME TO deliverables_task_id_idx;