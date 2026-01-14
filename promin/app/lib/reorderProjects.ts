import { supabase } from "./supabaseClient";

export async function reorderProjects(
  orderedProjectIds: number[]
) {
  try {
    for (let i = 0; i < orderedProjectIds.length; i++) {
      const { error } = await supabase
        .from("projects")
        .update({ position: i })
        .eq("id", orderedProjectIds[i])
        .is("deleted_at", null);


      if (error) throw error;
    }
  } catch (err) {
    console.error("Failed to reorder projects:", err);
    throw err;
  }
}
