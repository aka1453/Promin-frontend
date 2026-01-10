"use client";

import { useState } from "react";
import { supabase } from "../lib/supabaseClient";

export default function AddProjectButton({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);

async function loadUsers() {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name");

  if (!error && data) {
    setUsers(data);
  }
}

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
const [users, setUsers] = useState<any[]>([]);
const [projectManagerId, setProjectManagerId] = useState<string | null>(null);


  async function createProject() {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    alert("You must be logged in to create a project");
    return;
  }

  // Get current minimum position
  const { data: minPosData, error: minPosError } = await supabase
    .from("projects")
    .select("position")
    .order("position", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (minPosError) {
    alert("Failed to determine project position");
    console.error(minPosError);
    return;
  }

  const newPosition =
    minPosData?.position != null ? minPosData.position - 1 : 0;


  if (!user) {
    alert("You must be logged in to create a project");
    return;
  }

  // Project owner is the project manager by default

const { error } = await supabase.from("projects").insert({
  name,
  description,
  project_manager_id: user.id,
  owner_id: user.id,
  position: newPosition,
});


    if (error) {
      alert("Error creating project");
      console.error(error);
      return;
    }

    setName("");
    setDescription("");
setProjectManagerId(null);
setOpen(false);

    onCreated(); // 🔥 notify parent to refresh the list
  }

  return (
    <>
      <button
  onClick={() => {
    setOpen(true);
    loadUsers();
  }}
  className="px-4 py-2 bg-blue-600 text-white rounded"
>

        + Add Project
      </button>

      {open && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center">
          <div className="bg-white p-6 rounded-lg w-80" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-xl font-semibold mb-4">New Project</h2>

            <input
              className="w-full border rounded p-2 mb-4"
              placeholder="Project name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />

            <textarea
  className="w-full border rounded p-2 mb-4"
  placeholder="Description"
  value={description}
  onChange={(e) => setDescription(e.target.value)}
/>

{/* Project Manager defaults to Project Owner */}

            <div className="flex justify-end gap-2">
              <button className="px-3 py-2 bg-gray-200 rounded" onClick={() => setOpen(false)}>
                Cancel
              </button>
              <button className="px-3 py-2 bg-green-600 text-white rounded" onClick={createProject}>
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
