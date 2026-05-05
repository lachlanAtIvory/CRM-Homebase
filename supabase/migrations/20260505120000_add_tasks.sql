-- Tasks table for per-client task management
CREATE TABLE public.tasks (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id    UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  title        TEXT NOT NULL,
  due_date     DATE,
  completed_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at   TIMESTAMPTZ DEFAULT now() NOT NULL
);

CREATE INDEX tasks_client_id_idx ON public.tasks(client_id);
CREATE INDEX tasks_due_date_idx  ON public.tasks(due_date);

ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated full access to tasks"
  ON public.tasks FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

CREATE TRIGGER tasks_set_updated_at
  BEFORE UPDATE ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
