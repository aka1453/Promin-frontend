set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.user_owns_project(project_id_param bigint)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
AS $function$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM projects 
    WHERE id = project_id_param 
    AND owner_id = auth.uid()
  );
END;
$function$
;


  create policy "Users can view milestones in their projects"
  on "public"."milestones"
  as permissive
  for select
  to public
using (public.user_owns_project(project_id));



