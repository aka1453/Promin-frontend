


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_graphql" WITH SCHEMA "graphql";






CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE TYPE "public"."project_role" AS ENUM (
    'owner',
    'editor',
    'viewer'
);


ALTER TYPE "public"."project_role" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."enforce_lifecycle_on_subtask_update"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
declare
  v_task_id bigint;
  v_milestone_id bigint;
  v_project_id bigint;
begin
  -- Only care if subtask becomes NOT done
  if new.is_done = false then

    -- Get task
    select task_id into v_task_id
    from subtasks
    where id = new.id;

    -- Clear task completion
    update tasks
    set actual_end = null,
        status = 'in_progress'
    where id = v_task_id;

    -- Get milestone
    select milestone_id into v_milestone_id
    from tasks
    where id = v_task_id;

    -- Clear milestone completion
    update milestones
    set actual_end = null,
        status = 'in_progress'
    where id = v_milestone_id;

    -- Get project
    select project_id into v_project_id
    from milestones
    where id = v_milestone_id;

    -- Clear project completion
    update projects
    set actual_end = null,
        status = 'in_progress'
    where id = v_project_id;

  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."enforce_lifecycle_on_subtask_update"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', '')
  )
  ON CONFLICT (id) DO NOTHING;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."handle_new_user"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."has_project_role"("p_project_id" bigint, "p_user_id" "uuid", "p_min_role" "text") RETURNS boolean
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1
    FROM project_members pm
    WHERE pm.project_id = p_project_id
      AND pm.user_id = p_user_id
      AND (
        pm.role = 'owner'
        OR (pm.role = 'editor' AND p_min_role IN ('editor', 'viewer'))
        OR (pm.role = 'viewer' AND p_min_role = 'viewer')
      )
  );
$$;


ALTER FUNCTION "public"."has_project_role"("p_project_id" bigint, "p_user_id" "uuid", "p_min_role" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_project_member"("p_project_id" bigint, "p_user_id" "uuid") RETURNS boolean
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.project_members pm
    WHERE pm.project_id = p_project_id
      AND pm.user_id = p_user_id
  );
$$;


ALTER FUNCTION "public"."is_project_member"("p_project_id" bigint, "p_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_project_owner"("p_project_id" bigint, "p_user" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE
    AS $$
  SELECT EXISTS (
    SELECT 1
    FROM projects
    WHERE id = p_project_id
      AND owner_id = p_user
  );
$$;


ALTER FUNCTION "public"."is_project_owner"("p_project_id" bigint, "p_user" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."prevent_actual_start_change"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  IF OLD.actual_start IS NOT NULL
     AND NEW.actual_start IS DISTINCT FROM OLD.actual_start THEN
    RAISE EXCEPTION 'actual_start is immutable once set';
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."prevent_actual_start_change"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."activity_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "project_id" "uuid" NOT NULL,
    "user_id" "uuid",
    "entity_type" "text" NOT NULL,
    "entity_id" "uuid" NOT NULL,
    "action" "text" NOT NULL,
    "details" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "activity_logs_entity_type_check" CHECK (("entity_type" = ANY (ARRAY['project'::"text", 'milestone'::"text", 'task'::"text", 'subtask'::"text", 'document'::"text", 'version'::"text"])))
);


ALTER TABLE "public"."activity_logs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."comments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "project_id" "uuid" NOT NULL,
    "task_id" "uuid",
    "subtask_id" "uuid",
    "author_id" "uuid" NOT NULL,
    "body" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "comments_check" CHECK (((("task_id" IS NOT NULL) AND ("subtask_id" IS NULL)) OR (("task_id" IS NULL) AND ("subtask_id" IS NOT NULL))))
);


ALTER TABLE "public"."comments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."document_versions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "document_id" "uuid" NOT NULL,
    "version_number" integer NOT NULL,
    "storage_path" "text" NOT NULL,
    "file_size_bytes" bigint NOT NULL,
    "uploaded_by" "uuid" NOT NULL,
    "uploaded_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."document_versions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."documents" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "subtask_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "latest_version_id" "uuid",
    "created_by" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."documents" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."file_blobs" (
    "id" bigint NOT NULL,
    "file_id" bigint NOT NULL,
    "blob" "bytea" NOT NULL,
    "created_at" timestamp without time zone DEFAULT "now"()
);


ALTER TABLE "public"."file_blobs" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."file_blobs_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."file_blobs_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."file_blobs_id_seq" OWNED BY "public"."file_blobs"."id";



CREATE TABLE IF NOT EXISTS "public"."file_links" (
    "id" bigint NOT NULL,
    "milestone_id" bigint,
    "task_id" bigint,
    "subtask_id" bigint,
    "file_name" "text" NOT NULL,
    "file_path" "text" NOT NULL,
    "mime_type" "text",
    "size" bigint,
    "created_at" timestamp without time zone DEFAULT "now"()
);


ALTER TABLE "public"."file_links" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."file_links_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."file_links_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."file_links_id_seq" OWNED BY "public"."file_links"."id";



CREATE TABLE IF NOT EXISTS "public"."milestone_dependencies" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "project_id" "uuid" NOT NULL,
    "from_milestone_id" "uuid" NOT NULL,
    "to_milestone_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."milestone_dependencies" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."milestones" (
    "id" bigint NOT NULL,
    "project_id" bigint NOT NULL,
    "name" "text" NOT NULL,
    "planned_start" "date",
    "planned_end" "date",
    "actual_start" "date",
    "actual_end" "date",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "description" "text",
    "status" "text" DEFAULT 'pending'::"text",
    "planned_progress" numeric DEFAULT 0,
    "actual_progress" numeric DEFAULT 0,
    "budgeted_cost" numeric DEFAULT 0,
    "actual_cost" numeric DEFAULT 0,
    "weight" numeric DEFAULT 0 NOT NULL,
    "progress" numeric DEFAULT 0
);


ALTER TABLE "public"."milestones" OWNER TO "postgres";


ALTER TABLE "public"."milestones" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."milestones_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."organization_members" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "role" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "organization_members_role_check" CHECK (("role" = ANY (ARRAY['owner'::"text", 'admin'::"text", 'member'::"text"])))
);


ALTER TABLE "public"."organization_members" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "id" "uuid" NOT NULL,
    "full_name" "text" NOT NULL,
    "avatar_url" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "email" "text"
);


ALTER TABLE "public"."profiles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."project_members" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "project_id" bigint NOT NULL,
    "user_id" "uuid" NOT NULL,
    "role" "public"."project_role" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."project_members" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."project_members_expanded" WITH ("security_barrier"='true') AS
 SELECT "pm"."id",
    "pm"."project_id",
    "pm"."user_id",
    "pm"."role",
    "p"."email"
   FROM ("public"."project_members" "pm"
     JOIN "public"."profiles" "p" ON (("p"."id" = "pm"."user_id")));


ALTER VIEW "public"."project_members_expanded" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."projects" (
    "id" bigint NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "owner_id" "uuid",
    "planned_progress" numeric DEFAULT 0,
    "progress" numeric DEFAULT 0,
    "planned_start" "date",
    "planned_end" "date",
    "actual_start" "date",
    "actual_end" "date",
    "budgeted_cost" numeric,
    "actual_cost" numeric,
    "weight" numeric DEFAULT 1,
    "status" "text" DEFAULT 'pending'::"text",
    "position" integer DEFAULT 0 NOT NULL,
    "actual_progress" numeric DEFAULT 0,
    "project_manager_id" "uuid",
    "archived_at" timestamp with time zone,
    "archived_by" "uuid",
    "restored_at" timestamp with time zone,
    "restored_by" "uuid",
    "deleted_at" timestamp with time zone,
    "deleted_by" "uuid"
);


ALTER TABLE "public"."projects" OWNER TO "postgres";


ALTER TABLE "public"."projects" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."projects_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."subtask_file_versions" (
    "id" bigint NOT NULL,
    "file_id" bigint,
    "version_number" integer NOT NULL,
    "file_path" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "created_by" "uuid" DEFAULT "auth"."uid"()
);


ALTER TABLE "public"."subtask_file_versions" OWNER TO "postgres";


ALTER TABLE "public"."subtask_file_versions" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."subtask_file_versions_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."subtask_files" (
    "id" bigint NOT NULL,
    "subtask_id" bigint,
    "latest_version" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "created_by" "uuid"
);


ALTER TABLE "public"."subtask_files" OWNER TO "postgres";


ALTER TABLE "public"."subtask_files" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."subtask_files_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."subtasks" (
    "id" bigint NOT NULL,
    "task_id" bigint NOT NULL,
    "title" "text" NOT NULL,
    "description" "text",
    "status" "text" DEFAULT 'pending'::"text",
    "weight" numeric DEFAULT 0 NOT NULL,
    "planned_start" "date",
    "planned_end" "date",
    "actual_start" "date",
    "actual_end" "date",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "priority" "text" DEFAULT 'medium'::"text",
    "budgeted_cost" numeric,
    "actual_cost" numeric,
    "is_done" boolean DEFAULT false,
    "completed_at" timestamp with time zone,
    "assigned_user_id" "uuid",
    "assigned_by" "uuid",
    "assigned_user" "text",
    CONSTRAINT "subtasks_priority_check" CHECK (("priority" = ANY (ARRAY['low'::"text", 'medium'::"text", 'high'::"text"])))
);


ALTER TABLE "public"."subtasks" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."subtasks_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."subtasks_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."subtasks_id_seq" OWNED BY "public"."subtasks"."id";



CREATE TABLE IF NOT EXISTS "public"."task_attachments" (
    "id" bigint NOT NULL,
    "task_id" bigint,
    "file_url" "text" NOT NULL,
    "version" integer DEFAULT 1,
    "created_at" timestamp without time zone DEFAULT "now"()
);


ALTER TABLE "public"."task_attachments" OWNER TO "postgres";


ALTER TABLE "public"."task_attachments" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."task_attachments_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."tasks" (
    "id" bigint NOT NULL,
    "milestone_id" bigint NOT NULL,
    "title" "text" NOT NULL,
    "planned_start" "date",
    "planned_end" "date",
    "actual_start" "date",
    "actual_end" "date",
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "priority" "text" DEFAULT 'medium'::"text" NOT NULL,
    "assigned_to" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "order_index" integer,
    "progress" numeric DEFAULT 0 NOT NULL,
    "budgeted_cost" numeric DEFAULT 0,
    "actual_cost" numeric DEFAULT 0,
    "version" integer DEFAULT 1,
    "weight" numeric DEFAULT 0 NOT NULL,
    "description" "text",
    "updated_at" timestamp with time zone,
    "planned_progress" numeric DEFAULT 0,
    "sequence_group" integer,
    CONSTRAINT "actual_end_requires_start" CHECK ((("actual_end" IS NULL) OR ("actual_start" IS NOT NULL))),
    CONSTRAINT "completed_requires_actual_end" CHECK ((("status" <> 'completed'::"text") OR ("actual_end" IS NOT NULL))),
    CONSTRAINT "progress_range" CHECK ((("progress" >= (0)::numeric) AND ("progress" <= (100)::numeric))),
    CONSTRAINT "status_date_consistency" CHECK (((("status" = 'pending'::"text") AND ("actual_start" IS NULL) AND ("actual_end" IS NULL)) OR (("status" = 'in_progress'::"text") AND ("actual_start" IS NOT NULL) AND ("actual_end" IS NULL)) OR (("status" = 'completed'::"text") AND ("actual_start" IS NOT NULL) AND ("actual_end" IS NOT NULL)))),
    CONSTRAINT "tasks_priority_check" CHECK (("priority" = ANY (ARRAY['low'::"text", 'medium'::"text", 'high'::"text"]))),
    CONSTRAINT "tasks_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'in_progress'::"text", 'completed'::"text"])))
);


ALTER TABLE "public"."tasks" OWNER TO "postgres";


ALTER TABLE "public"."tasks" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."tasks_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."user_subscriptions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "plan_id" "uuid" NOT NULL,
    "stripe_customer_id" "text",
    "stripe_subscription_id" "text",
    "status" "text" NOT NULL,
    "current_period_end" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "user_subscriptions_status_check" CHECK (("status" = ANY (ARRAY['active'::"text", 'canceled'::"text", 'past_due'::"text", 'trialing'::"text"])))
);


ALTER TABLE "public"."user_subscriptions" OWNER TO "postgres";


ALTER TABLE ONLY "public"."file_blobs" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."file_blobs_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."file_links" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."file_links_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."subtasks" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."subtasks_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."activity_logs"
    ADD CONSTRAINT "activity_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."comments"
    ADD CONSTRAINT "comments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."document_versions"
    ADD CONSTRAINT "document_versions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."documents"
    ADD CONSTRAINT "documents_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."file_blobs"
    ADD CONSTRAINT "file_blobs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."file_links"
    ADD CONSTRAINT "file_links_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."milestone_dependencies"
    ADD CONSTRAINT "milestone_dependencies_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."milestones"
    ADD CONSTRAINT "milestones_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."organization_members"
    ADD CONSTRAINT "organization_members_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."project_members"
    ADD CONSTRAINT "project_members_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."project_members"
    ADD CONSTRAINT "project_members_project_id_user_id_key" UNIQUE ("project_id", "user_id");



ALTER TABLE ONLY "public"."projects"
    ADD CONSTRAINT "projects_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."subtask_file_versions"
    ADD CONSTRAINT "subtask_file_versions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."subtask_files"
    ADD CONSTRAINT "subtask_files_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."subtasks"
    ADD CONSTRAINT "subtasks_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."task_attachments"
    ADD CONSTRAINT "task_attachments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."tasks"
    ADD CONSTRAINT "tasks_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_subscriptions"
    ADD CONSTRAINT "user_subscriptions_pkey" PRIMARY KEY ("id");



CREATE UNIQUE INDEX "one_owner_per_project" ON "public"."project_members" USING "btree" ("project_id") WHERE ("role" = 'owner'::"public"."project_role");



CREATE UNIQUE INDEX "profiles_email_unique" ON "public"."profiles" USING "btree" ("email");



CREATE OR REPLACE TRIGGER "trg_enforce_lifecycle_on_subtask" AFTER UPDATE OF "is_done" ON "public"."subtasks" FOR EACH ROW EXECUTE FUNCTION "public"."enforce_lifecycle_on_subtask_update"();



CREATE OR REPLACE TRIGGER "trg_prevent_actual_start_change" BEFORE UPDATE ON "public"."tasks" FOR EACH ROW EXECUTE FUNCTION "public"."prevent_actual_start_change"();



ALTER TABLE ONLY "public"."activity_logs"
    ADD CONSTRAINT "activity_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."document_versions"
    ADD CONSTRAINT "document_versions_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."file_blobs"
    ADD CONSTRAINT "fk_file_blob" FOREIGN KEY ("file_id") REFERENCES "public"."file_links"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."project_members"
    ADD CONSTRAINT "project_members_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."project_members"
    ADD CONSTRAINT "project_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."projects"
    ADD CONSTRAINT "projects_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."projects"
    ADD CONSTRAINT "projects_project_manager_fkey" FOREIGN KEY ("project_manager_id") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."projects"
    ADD CONSTRAINT "projects_project_manager_id_fkey" FOREIGN KEY ("project_manager_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."subtask_file_versions"
    ADD CONSTRAINT "subtask_file_versions_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "public"."subtask_files"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."subtask_files"
    ADD CONSTRAINT "subtask_files_subtask_id_fkey" FOREIGN KEY ("subtask_id") REFERENCES "public"."subtasks"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."subtasks"
    ADD CONSTRAINT "subtasks_assigned_by_fkey" FOREIGN KEY ("assigned_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."subtasks"
    ADD CONSTRAINT "subtasks_assigned_user_id_fkey" FOREIGN KEY ("assigned_user_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."subtasks"
    ADD CONSTRAINT "subtasks_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."task_attachments"
    ADD CONSTRAINT "task_attachments_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE CASCADE;



CREATE POLICY "Allow all delete" ON "public"."file_blobs" FOR DELETE USING (true);



CREATE POLICY "Allow all delete" ON "public"."file_links" FOR DELETE USING (true);



CREATE POLICY "Allow all insert" ON "public"."file_blobs" FOR INSERT WITH CHECK (true);



CREATE POLICY "Allow all insert" ON "public"."file_links" FOR INSERT WITH CHECK (true);



CREATE POLICY "Allow all read" ON "public"."file_blobs" FOR SELECT USING (true);



CREATE POLICY "Allow all read" ON "public"."file_links" FOR SELECT USING (true);



CREATE POLICY "Allow all update" ON "public"."file_blobs" FOR UPDATE USING (true);



CREATE POLICY "Allow all update" ON "public"."file_links" FOR UPDATE USING (true);



CREATE POLICY "Members can reorder projects" ON "public"."projects" FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM "public"."project_members" "pm"
  WHERE (("pm"."project_id" = "projects"."id") AND ("pm"."user_id" = "auth"."uid"()) AND ("pm"."role" = ANY (ARRAY['owner'::"public"."project_role", 'editor'::"public"."project_role"]))))));



CREATE POLICY "Profiles are readable by authenticated users" ON "public"."profiles" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "allow profile lookup by email" ON "public"."profiles" FOR SELECT USING (("auth"."role"() = 'authenticated'::"text"));



CREATE POLICY "authenticated users can read profiles" ON "public"."profiles" FOR SELECT USING (("auth"."role"() = 'authenticated'::"text"));



CREATE POLICY "dev_insert_subtask_files" ON "public"."subtask_files" FOR INSERT TO "authenticated", "anon" WITH CHECK (true);



CREATE POLICY "dev_select_subtask_files" ON "public"."subtask_files" FOR SELECT TO "authenticated", "anon" USING (true);



ALTER TABLE "public"."file_blobs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."file_links" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "insert_subtask_file_versions" ON "public"."subtask_file_versions" FOR INSERT TO "authenticated" WITH CHECK (("created_by" = "auth"."uid"()));



ALTER TABLE "public"."milestones" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "milestones_delete_owner_only_when_not_archived" ON "public"."milestones" FOR DELETE USING ((EXISTS ( SELECT 1
   FROM "public"."projects" "p"
  WHERE (("p"."id" = "milestones"."project_id") AND ("p"."status" <> 'archived'::"text") AND ("p"."owner_id" = "auth"."uid"())))));



CREATE POLICY "milestones_insert_owner_or_editor_not_archived" ON "public"."milestones" FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."projects" "p"
  WHERE (("p"."id" = "milestones"."project_id") AND ("p"."status" <> 'archived'::"text") AND (("p"."owner_id" = "auth"."uid"()) OR "public"."has_project_role"("p"."id", "auth"."uid"(), 'editor'::"text"))))));



CREATE POLICY "milestones_select_owner_or_member" ON "public"."milestones" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."projects" "p"
  WHERE (("p"."id" = "milestones"."project_id") AND (("p"."owner_id" = "auth"."uid"()) OR "public"."is_project_member"("p"."id", "auth"."uid"()))))));



CREATE POLICY "milestones_update_owner_or_editor_not_archived" ON "public"."milestones" FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM "public"."projects" "p"
  WHERE (("p"."id" = "milestones"."project_id") AND ("p"."status" <> 'archived'::"text") AND (("p"."owner_id" = "auth"."uid"()) OR "public"."has_project_role"("p"."id", "auth"."uid"(), 'editor'::"text")))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."projects" "p"
  WHERE (("p"."id" = "milestones"."project_id") AND ("p"."status" <> 'archived'::"text") AND (("p"."owner_id" = "auth"."uid"()) OR "public"."has_project_role"("p"."id", "auth"."uid"(), 'editor'::"text"))))));



CREATE POLICY "pm_delete_owner_only" ON "public"."project_members" FOR DELETE USING ("public"."is_project_owner"("project_id", "auth"."uid"()));



CREATE POLICY "pm_insert_owner_only" ON "public"."project_members" FOR INSERT WITH CHECK ("public"."is_project_owner"("project_id", "auth"."uid"()));



CREATE POLICY "pm_update_owner_only" ON "public"."project_members" FOR UPDATE USING ("public"."is_project_owner"("project_id", "auth"."uid"()));



ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."project_members" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "project_members_select_own_rows" ON "public"."project_members" FOR SELECT USING (("user_id" = "auth"."uid"()));



ALTER TABLE "public"."projects" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "projects_archive_owner_only" ON "public"."projects" FOR UPDATE USING ((("auth"."uid"() IS NOT NULL) AND ("owner_id" = "auth"."uid"()) AND ("status" <> 'archived'::"text"))) WITH CHECK (("status" = 'archived'::"text"));



CREATE POLICY "projects_delete_owner_only" ON "public"."projects" FOR DELETE USING ((("auth"."uid"() = "owner_id") AND ("deleted_at" IS NOT NULL)));



CREATE POLICY "projects_insert_owner" ON "public"."projects" FOR INSERT WITH CHECK (("owner_id" = "auth"."uid"()));



CREATE POLICY "projects_restore_owner_only" ON "public"."projects" FOR UPDATE USING ((("auth"."uid"() IS NOT NULL) AND ("owner_id" = "auth"."uid"()) AND ("status" = 'archived'::"text"))) WITH CHECK (("status" <> 'archived'::"text"));



CREATE POLICY "projects_select_deleted_owner_or_member" ON "public"."projects" FOR SELECT USING ((("deleted_at" IS NOT NULL) AND (("owner_id" = "auth"."uid"()) OR (EXISTS ( SELECT 1
   FROM "public"."project_members" "pm"
  WHERE (("pm"."project_id" = "projects"."id") AND ("pm"."user_id" = "auth"."uid"())))))));



CREATE POLICY "projects_select_owner_or_member" ON "public"."projects" FOR SELECT USING ((("auth"."uid"() = "owner_id") OR (EXISTS ( SELECT 1
   FROM "public"."project_members" "pm"
  WHERE (("pm"."project_id" = "projects"."id") AND ("pm"."user_id" = "auth"."uid"()))))));



CREATE POLICY "projects_update_owner_or_editor_not_archived" ON "public"."projects" FOR UPDATE USING ((("auth"."uid"() IS NOT NULL) AND ("status" <> 'archived'::"text") AND (("owner_id" = "auth"."uid"()) OR "public"."has_project_role"("id", "auth"."uid"(), 'editor'::"text")))) WITH CHECK (("status" <> 'archived'::"text"));



CREATE POLICY "select_subtask_file_versions" ON "public"."subtask_file_versions" FOR SELECT TO "authenticated" USING (("created_by" = "auth"."uid"()));



ALTER TABLE "public"."subtask_file_versions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "subtask_file_versions_delete_project_owner" ON "public"."subtask_file_versions" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM (((("public"."subtask_files" "f"
     JOIN "public"."subtasks" "s" ON (("s"."id" = "f"."subtask_id")))
     JOIN "public"."tasks" "t" ON (("t"."id" = "s"."task_id")))
     JOIN "public"."milestones" "m" ON (("m"."id" = "t"."milestone_id")))
     JOIN "public"."projects" "p" ON (("p"."id" = "m"."project_id")))
  WHERE (("f"."id" = "subtask_file_versions"."file_id") AND ("p"."owner_id" = "auth"."uid"())))));



CREATE POLICY "subtask_file_versions_insert_auth" ON "public"."subtask_file_versions" FOR INSERT TO "authenticated" WITH CHECK (("auth"."uid"() IS NOT NULL));



CREATE POLICY "subtask_file_versions_select_auth" ON "public"."subtask_file_versions" FOR SELECT TO "authenticated" USING (("auth"."uid"() IS NOT NULL));



ALTER TABLE "public"."subtask_files" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "subtask_files_all_auth" ON "public"."subtask_files" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "subtask_files_delete_project_owner" ON "public"."subtask_files" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM ((("public"."subtasks" "s"
     JOIN "public"."tasks" "t" ON (("t"."id" = "s"."task_id")))
     JOIN "public"."milestones" "m" ON (("m"."id" = "t"."milestone_id")))
     JOIN "public"."projects" "p" ON (("p"."id" = "m"."project_id")))
  WHERE (("s"."id" = "subtask_files"."subtask_id") AND ("p"."owner_id" = "auth"."uid"())))));



CREATE POLICY "subtask_files_insert_auth" ON "public"."subtask_files" FOR INSERT TO "authenticated" WITH CHECK (("auth"."uid"() IS NOT NULL));



CREATE POLICY "subtask_files_select_auth" ON "public"."subtask_files" FOR SELECT TO "authenticated" USING (("auth"."uid"() IS NOT NULL));



ALTER TABLE "public"."subtasks" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "subtasks_delete_owner_or_editor_not_archived" ON "public"."subtasks" FOR DELETE USING ((EXISTS ( SELECT 1
   FROM (("public"."tasks" "t"
     JOIN "public"."milestones" "m" ON (("m"."id" = "t"."milestone_id")))
     JOIN "public"."projects" "p" ON (("p"."id" = "m"."project_id")))
  WHERE (("t"."id" = "subtasks"."task_id") AND ("p"."status" <> 'archived'::"text") AND (("p"."owner_id" = "auth"."uid"()) OR "public"."has_project_role"("p"."id", "auth"."uid"(), 'editor'::"text"))))));



CREATE POLICY "subtasks_insert_owner_or_editor_not_archived" ON "public"."subtasks" FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM (("public"."tasks" "t"
     JOIN "public"."milestones" "m" ON (("m"."id" = "t"."milestone_id")))
     JOIN "public"."projects" "p" ON (("p"."id" = "m"."project_id")))
  WHERE (("t"."id" = "subtasks"."task_id") AND ("p"."status" <> 'archived'::"text") AND (("p"."owner_id" = "auth"."uid"()) OR "public"."has_project_role"("p"."id", "auth"."uid"(), 'editor'::"text"))))));



CREATE POLICY "subtasks_select_owner_or_member" ON "public"."subtasks" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM (("public"."tasks" "t"
     JOIN "public"."milestones" "m" ON (("m"."id" = "t"."milestone_id")))
     JOIN "public"."projects" "p" ON (("p"."id" = "m"."project_id")))
  WHERE (("t"."id" = "subtasks"."task_id") AND (("p"."owner_id" = "auth"."uid"()) OR "public"."is_project_member"("p"."id", "auth"."uid"()))))));



CREATE POLICY "subtasks_update_owner_or_editor_not_archived" ON "public"."subtasks" FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM (("public"."tasks" "t"
     JOIN "public"."milestones" "m" ON (("m"."id" = "t"."milestone_id")))
     JOIN "public"."projects" "p" ON (("p"."id" = "m"."project_id")))
  WHERE (("t"."id" = "subtasks"."task_id") AND ("p"."status" <> 'archived'::"text") AND (("p"."owner_id" = "auth"."uid"()) OR "public"."has_project_role"("p"."id", "auth"."uid"(), 'editor'::"text")))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM (("public"."tasks" "t"
     JOIN "public"."milestones" "m" ON (("m"."id" = "t"."milestone_id")))
     JOIN "public"."projects" "p" ON (("p"."id" = "m"."project_id")))
  WHERE (("t"."id" = "subtasks"."task_id") AND ("p"."status" <> 'archived'::"text") AND (("p"."owner_id" = "auth"."uid"()) OR "public"."has_project_role"("p"."id", "auth"."uid"(), 'editor'::"text"))))));



ALTER TABLE "public"."tasks" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "tasks_delete_owner_or_editor_not_archived" ON "public"."tasks" FOR DELETE USING ((EXISTS ( SELECT 1
   FROM ("public"."milestones" "m"
     JOIN "public"."projects" "p" ON (("p"."id" = "m"."project_id")))
  WHERE (("m"."id" = "tasks"."milestone_id") AND "public"."has_project_role"("p"."id", "auth"."uid"(), 'editor'::"text") AND ("p"."status" <> 'archived'::"text")))));



CREATE POLICY "tasks_insert_owner_or_editor_not_archived" ON "public"."tasks" FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM ("public"."milestones" "m"
     JOIN "public"."projects" "p" ON (("p"."id" = "m"."project_id")))
  WHERE (("m"."id" = "tasks"."milestone_id") AND "public"."has_project_role"("p"."id", "auth"."uid"(), 'editor'::"text") AND ("p"."status" <> 'archived'::"text")))));



CREATE POLICY "tasks_select_owner_or_member" ON "public"."tasks" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM ("public"."milestones" "m"
     JOIN "public"."projects" "p" ON (("p"."id" = "m"."project_id")))
  WHERE (("m"."id" = "tasks"."milestone_id") AND (("p"."owner_id" = "auth"."uid"()) OR "public"."is_project_member"("p"."id", "auth"."uid"()))))));



CREATE POLICY "tasks_update_owner_or_editor_not_archived" ON "public"."tasks" FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM ("public"."milestones" "m"
     JOIN "public"."projects" "p" ON (("p"."id" = "m"."project_id")))
  WHERE (("m"."id" = "tasks"."milestone_id") AND "public"."has_project_role"("p"."id", "auth"."uid"(), 'editor'::"text") AND ("p"."status" <> 'archived'::"text"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM ("public"."milestones" "m"
     JOIN "public"."projects" "p" ON (("p"."id" = "m"."project_id")))
  WHERE (("m"."id" = "tasks"."milestone_id") AND ("p"."status" <> 'archived'::"text")))));



CREATE POLICY "update_subtask_file_versions" ON "public"."subtask_file_versions" FOR UPDATE TO "authenticated" USING (("created_by" = "auth"."uid"()));



CREATE POLICY "users update own profile" ON "public"."profiles" FOR UPDATE USING (("auth"."uid"() = "id"));





ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";


GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";

























































































































































GRANT ALL ON FUNCTION "public"."enforce_lifecycle_on_subtask_update"() TO "anon";
GRANT ALL ON FUNCTION "public"."enforce_lifecycle_on_subtask_update"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."enforce_lifecycle_on_subtask_update"() TO "service_role";



GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "service_role";



GRANT ALL ON FUNCTION "public"."has_project_role"("p_project_id" bigint, "p_user_id" "uuid", "p_min_role" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."has_project_role"("p_project_id" bigint, "p_user_id" "uuid", "p_min_role" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."has_project_role"("p_project_id" bigint, "p_user_id" "uuid", "p_min_role" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."is_project_member"("p_project_id" bigint, "p_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."is_project_member"("p_project_id" bigint, "p_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_project_member"("p_project_id" bigint, "p_user_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."is_project_owner"("p_project_id" bigint, "p_user" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."is_project_owner"("p_project_id" bigint, "p_user" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_project_owner"("p_project_id" bigint, "p_user" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."prevent_actual_start_change"() TO "anon";
GRANT ALL ON FUNCTION "public"."prevent_actual_start_change"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."prevent_actual_start_change"() TO "service_role";


















GRANT ALL ON TABLE "public"."activity_logs" TO "anon";
GRANT ALL ON TABLE "public"."activity_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."activity_logs" TO "service_role";



GRANT ALL ON TABLE "public"."comments" TO "anon";
GRANT ALL ON TABLE "public"."comments" TO "authenticated";
GRANT ALL ON TABLE "public"."comments" TO "service_role";



GRANT ALL ON TABLE "public"."document_versions" TO "anon";
GRANT ALL ON TABLE "public"."document_versions" TO "authenticated";
GRANT ALL ON TABLE "public"."document_versions" TO "service_role";



GRANT ALL ON TABLE "public"."documents" TO "anon";
GRANT ALL ON TABLE "public"."documents" TO "authenticated";
GRANT ALL ON TABLE "public"."documents" TO "service_role";



GRANT ALL ON TABLE "public"."file_blobs" TO "anon";
GRANT ALL ON TABLE "public"."file_blobs" TO "authenticated";
GRANT ALL ON TABLE "public"."file_blobs" TO "service_role";



GRANT ALL ON SEQUENCE "public"."file_blobs_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."file_blobs_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."file_blobs_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."file_links" TO "anon";
GRANT ALL ON TABLE "public"."file_links" TO "authenticated";
GRANT ALL ON TABLE "public"."file_links" TO "service_role";



GRANT ALL ON SEQUENCE "public"."file_links_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."file_links_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."file_links_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."milestone_dependencies" TO "anon";
GRANT ALL ON TABLE "public"."milestone_dependencies" TO "authenticated";
GRANT ALL ON TABLE "public"."milestone_dependencies" TO "service_role";



GRANT ALL ON TABLE "public"."milestones" TO "anon";
GRANT ALL ON TABLE "public"."milestones" TO "authenticated";
GRANT ALL ON TABLE "public"."milestones" TO "service_role";



GRANT ALL ON SEQUENCE "public"."milestones_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."milestones_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."milestones_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."organization_members" TO "anon";
GRANT ALL ON TABLE "public"."organization_members" TO "authenticated";
GRANT ALL ON TABLE "public"."organization_members" TO "service_role";



GRANT ALL ON TABLE "public"."profiles" TO "anon";
GRANT ALL ON TABLE "public"."profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."profiles" TO "service_role";



GRANT ALL ON TABLE "public"."project_members" TO "anon";
GRANT ALL ON TABLE "public"."project_members" TO "authenticated";
GRANT ALL ON TABLE "public"."project_members" TO "service_role";



GRANT ALL ON TABLE "public"."project_members_expanded" TO "anon";
GRANT ALL ON TABLE "public"."project_members_expanded" TO "authenticated";
GRANT ALL ON TABLE "public"."project_members_expanded" TO "service_role";



GRANT ALL ON TABLE "public"."projects" TO "anon";
GRANT ALL ON TABLE "public"."projects" TO "authenticated";
GRANT ALL ON TABLE "public"."projects" TO "service_role";



GRANT ALL ON SEQUENCE "public"."projects_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."projects_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."projects_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."subtask_file_versions" TO "anon";
GRANT ALL ON TABLE "public"."subtask_file_versions" TO "authenticated";
GRANT ALL ON TABLE "public"."subtask_file_versions" TO "service_role";



GRANT ALL ON SEQUENCE "public"."subtask_file_versions_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."subtask_file_versions_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."subtask_file_versions_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."subtask_files" TO "anon";
GRANT ALL ON TABLE "public"."subtask_files" TO "authenticated";
GRANT ALL ON TABLE "public"."subtask_files" TO "service_role";



GRANT ALL ON SEQUENCE "public"."subtask_files_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."subtask_files_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."subtask_files_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."subtasks" TO "anon";
GRANT ALL ON TABLE "public"."subtasks" TO "authenticated";
GRANT ALL ON TABLE "public"."subtasks" TO "service_role";



GRANT ALL ON SEQUENCE "public"."subtasks_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."subtasks_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."subtasks_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."task_attachments" TO "anon";
GRANT ALL ON TABLE "public"."task_attachments" TO "authenticated";
GRANT ALL ON TABLE "public"."task_attachments" TO "service_role";



GRANT ALL ON SEQUENCE "public"."task_attachments_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."task_attachments_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."task_attachments_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."tasks" TO "anon";
GRANT ALL ON TABLE "public"."tasks" TO "authenticated";
GRANT ALL ON TABLE "public"."tasks" TO "service_role";



GRANT ALL ON SEQUENCE "public"."tasks_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."tasks_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."tasks_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."user_subscriptions" TO "anon";
GRANT ALL ON TABLE "public"."user_subscriptions" TO "authenticated";
GRANT ALL ON TABLE "public"."user_subscriptions" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";































