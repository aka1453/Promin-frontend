-- Add FK from project_members.user_id to profiles.id
-- This enables PostgREST joins: project_members -> profiles(full_name, email)
-- The existing FK to auth.users remains; this adds a second FK to public.profiles.

ALTER TABLE public.project_members
  ADD CONSTRAINT project_members_user_id_profiles_fkey
  FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

-- Notify PostgREST to reload schema cache
NOTIFY pgrst, 'reload schema';
