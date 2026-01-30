alter table "public"."tasks" add column "duration_days" integer default 1;

CREATE INDEX idx_tasks_duration ON public.tasks USING btree (duration_days);


