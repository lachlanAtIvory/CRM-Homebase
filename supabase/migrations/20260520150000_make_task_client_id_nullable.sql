-- Allow tasks to exist without being linked to a client — used for internal
-- admin tasks created directly from /tasks (e.g. "follow up with accountant",
-- "renew domain", etc.)
ALTER TABLE public.tasks
  ALTER COLUMN client_id DROP NOT NULL;
