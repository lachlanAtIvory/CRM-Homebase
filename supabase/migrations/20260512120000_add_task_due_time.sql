-- Add optional due_time to tasks (nullable — existing tasks remain date-only)
ALTER TABLE public.tasks
  ADD COLUMN due_time TIME;
