"use client";

import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { canEdit, isOwner } from "../utils/permissions";

type Props = {
  project: any;
  projectRole: 'owner' | 'editor' | 'viewer' | null;
  onClose: () => void;
};


export default function ProjectSettingsModal({ project,projectRole, onClose }: Props) {
  console.log("MODAL projectRole:", projectRole);
  // TEMP: Pro gating (hardcoded for now)
  const isPro = true;
  const isArchived = project?.status === "archived";
  const isOwnerUser = isOwner(projectRole);
  const [name, setName] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Invite collaborators state
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"editor" | "viewer">("viewer");
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviting, setInviting] = useState(false);
  // Collaborators list
  const [members, setMembers] = useState<
    { user_id: string; email: string; role: "owner" | "editor" | "viewer" }[]
    >([]);
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [inviteSuccess, setInviteSuccess] = useState<string | null>(null);


  // Keep local state in sync when a different project is selected
  useEffect(() => {
  setName(project?.name ?? "");

  async function loadMembers() {
    if (!project?.id || !isOwner(projectRole)) return;

    setLoadingMembers(true);

    const { data, error } = await supabase
  .from("project_members_expanded")
  .select("user_id, role, email")
  .eq("project_id", project.id);



console.log("RLS DEBUG — raw data:", data);
console.log("RLS DEBUG — error:", error);
console.log("RLS DEBUG — projectId:", project.id);
console.log("RLS DEBUG — projectRole:", projectRole);

if (!error && data) {
  setMembers(
  data.map((m: any) => ({
    user_id: m.user_id,
    role: m.role,
    email: m.email,
  }))
);

}


    setLoadingMembers(false);
  }

  loadMembers();
}, [project?.id, projectRole]);


  if (!project) return null;
console.log("Project role:", projectRole);

  async function saveName() {
    if (isArchived) return;
    const trimmed = name.trim();
    if (!trimmed) return;
    if (trimmed === (project.name ?? "")) return;

    setSaving(true);

    const { error } = await supabase
      .from("projects")
      .update({ name: trimmed })
      .eq("id", project.id);

    setSaving(false);

    if (error) {
      console.error("Failed to update project name:", error);
      return;
    }

    // optimistic sync (so the modal text updates immediately)
    project.name = trimmed;
  }
async function inviteByEmail() {
  if (!project || !inviteEmail) return;

  setInviteError(null);
  setInviting(true);

  const email = inviteEmail.trim().toLowerCase();

  // 1) Find existing user by email
  const { data: profile, error: findError } = await supabase
    .from("profiles")
    .select("id")
    .eq("email", email)
    .single();

  if (findError || !profile) {
    setInviteError("User must already have a ProMin account.");
    setInviting(false);
    return;
  }

  // Prevent inviting owner
  if (profile.id === project.owner_id) {
    setInviteError("Project owner is already a collaborator.");
    setInviting(false);
    return;
  }

  // 2) Insert into project_members
  const { error: insertError } = await supabase
    .from("project_members")
    .insert({
      project_id: project.id,
      user_id: profile.id,
      role: inviteRole,
    });

  if (insertError) {
    if (insertError.code === "23505") {
      setInviteError("User is already a collaborator.");
    } else {
      setInviteError("Failed to invite collaborator.");
    }
    setInviting(false);
    return;
  }

  setInviteEmail("");
setInviteSuccess("Invitation sent successfully.");
setInviting(false);

// Clear success message after 3s
setTimeout(() => setInviteSuccess(null), 3000);

}
async function updateMemberRole(
  userId: string,
  newRole: "editor" | "viewer"
) {
  const { error } = await supabase
    .from("project_members")
    .update({ role: newRole })
    .eq("project_id", project.id)
    .eq("user_id", userId);

  if (error) {
    alert("Failed to update role");
    return;
  }

  setMembers((prev) =>
    prev.map((m) =>
      m.user_id === userId ? { ...m, role: newRole } : m
    )
  );
}
async function removeMember(userId: string) {
  if (userId === project.owner_id) return;

  const confirmed = confirm("Remove this collaborator?");
  if (!confirmed) return;

  const { error } = await supabase
    .from("project_members")
    .delete()
    .eq("project_id", project.id)
    .eq("user_id", userId);

  if (error) {
    alert("Failed to remove collaborator");
    return;
  }

  setMembers((prev) => prev.filter((m) => m.user_id !== userId));
}

  async function archiveProject() {
  const confirmed = confirm(
    `Archive project "${project.name}"?\n\nYou can restore it later from Archived projects.`
  );
  if (!confirmed) return;

  const { error } = await supabase
    .from("projects")
    .update({
  status: "archived",
  archived_at: new Date().toISOString(),
  archived_by: (await supabase.auth.getUser()).data?.user?.id ?? null,
})


    .eq("id", project.id);

  if (error) {
    console.error("Failed to archive project:", error);
    alert("Failed to archive project");
    return;
  }

  onClose();
  location.reload();
}
async function restoreProject() {
  const confirmed = confirm(
    `Restore project "${project.name}"?\n\nThis will make the project editable again.`
  );
  if (!confirmed) return;

  const { data: auth } = await supabase.auth.getUser();

const { error } = await supabase
  .from("projects")
  .update({
    status: "in_progress",
    archived_at: null,
    archived_by: null,
  })
  .eq("id", project.id);

  if (error) {
    console.error("Failed to restore project:", error);
    alert("Failed to restore project");
    return;
  }

  onClose();
  location.reload();
}


  async function deleteProject() {
    const confirmed = confirm(
      `Delete project "${project.name}"? This cannot be undone.`
    );
    if (!confirmed) return;

    setDeleting(true);

    const { data: auth } = await supabase.auth.getUser();

const { error } = await supabase
  .from("projects")
  .update({
  deleted_at: new Date().toISOString(),
  deleted_by: auth.user?.id ?? null,
})

  .eq("id", project.id);


    setDeleting(false);

    if (error) {
      console.error("Failed to delete project:", error);
      return;
    }

    onClose();
    // Simple and reliable refresh of the list given current architecture
    location.reload();
  }

  return (
    <div
      className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center"
      onClick={onClose}
    >
      <div
        className="bg-white w-[420px] rounded-xl p-6 space-y-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold text-slate-900">Project Settings</h2>
        {isArchived && (
  <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 space-y-1">
    <div>This project is archived. Restore it to make changes.</div>

    {project.archived_at && (
      <div className="text-xs text-amber-700">
        Archived on{" "}
        {new Date(project.archived_at).toLocaleString()}
      </div>
    )}
  </div>
)}

        {/* Project Name */}
        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1">
            Project Name
          </label>
          <input
  value={name}
  onChange={
  canEdit(projectRole) && project.status !== "archived"
    ? (e) => setName(e.target.value)
    : undefined
}
  disabled={!canEdit(projectRole) || project.status === "archived"}
  className={`w-full border rounded-lg px-3 py-2 text-sm ${
    !canEdit(projectRole) ? "bg-slate-100 cursor-not-allowed" : ""
  }`}
  placeholder="Enter project name"
/>

        </div>

                {/* Project Owner */}
        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1">
            Project Owner
          </label>

          <div className="w-full border rounded-lg px-3 py-2 text-sm bg-slate-50 text-slate-700">
            {project.project_manager?.full_name ?? "You"}
          </div>

          <p className="mt-1 text-xs text-slate-400">
            Project owner is fixed in v1
          </p>

          {/* Collaborators */}
          <div className="mt-4">
            <label className="block text-xs font-medium text-slate-500 mb-2">
              Collaborators
            </label>

            {!isOwner(projectRole) && (
              <p className="text-xs text-slate-400">
                Only the project owner can manage collaborators.
              </p>
            )}

            {isOwner(projectRole) && !isArchived && (
  <>
                {loadingMembers && (
                  <p className="text-xs text-slate-400 mb-2">
                    Loading collaborators…
                  </p>
                )}

                {!loadingMembers && members.length === 0 && (
                  <p className="text-xs text-slate-400 mb-2">
                    No collaborators yet.
                  </p>
                )}

                {members.map((m) => (
                  <div
                    key={m.user_id}
                    className="flex items-center justify-between border rounded-lg px-3 py-2 mb-2 text-sm"
                  >
                    <span className="truncate">{m.email}</span>

                    {m.user_id === project.owner_id ? (
  <span className="text-xs font-semibold px-2 py-1 rounded-md bg-slate-100 text-slate-600">
    Owner
  </span>
) : (
  <div className="flex items-center gap-2">
    <select
      value={m.role}
      onChange={(e) =>
        updateMemberRole(
          m.user_id,
          e.target.value as "editor" | "viewer"
        )
      }
      className="border rounded px-2 py-1 text-xs"
    >
      <option value="viewer">Viewer</option>
      <option value="editor">Editor</option>
    </select>

    <button
      onClick={() => removeMember(m.user_id)}
      className="text-xs text-red-600 hover:underline"
    >
      Remove
    </button>
  </div>
)}

                  </div>
                ))}

                {!isPro && (
                  <div className="border rounded-lg px-3 py-3 text-sm bg-slate-50 text-slate-400">
                    Collaboration is available on the Pro plan.
                  </div>
                )}

                {isPro && (
                  <div className="space-y-2 mt-3">
                    <input
                      type="email"
                      placeholder="Teammate email"
                      value={inviteEmail}
                      onChange={(e) => setInviteEmail(e.target.value)}
                      className="w-full border rounded-lg px-3 py-2 text-sm"
                    />

                    <div className="flex gap-2">
                      <select
                        value={inviteRole}
                        onChange={(e) =>
                          setInviteRole(e.target.value as "editor" | "viewer")
                        }
                        className="flex-1 border rounded-lg px-3 py-2 text-sm"
                      >
                        <option value="viewer">Viewer</option>
                        <option value="editor">Editor</option>
                      </select>

                      <button
                        onClick={inviteByEmail}
                        disabled={inviting || !inviteEmail}
                        className="px-3 py-2 rounded-lg text-sm bg-blue-600 text-white disabled:opacity-50"
                      >
                        Invite
                      </button>
                    </div>

                    {inviteError && (
                      <p className="text-xs text-red-600">{inviteError}</p>
                    )}
                    {inviteSuccess && (
                      <p className="text-xs text-green-600">{inviteSuccess}</p>
                    )}

                    <p className="text-xs text-slate-400">
                      Invite teammates who already use ProMin.
                    </p>
                  </div>
                )}
              </>
            )}
          </div>
        </div>


        {/* Divider */}
        <div className="border-t pt-4 text-xs text-slate-400">
          Advanced actions are restricted to the project owner
        </div>

        {/* Danger Zone (only delete active for now) */}
        <div className="space-y-2">
          {isOwner(projectRole) && !isArchived && (
  <button
    onClick={archiveProject}
    className="w-full border border-amber-200 text-amber-700 rounded-lg py-2 text-left px-3 hover:bg-amber-50"
  >
    Archive Project
  </button>
)}

{isOwner(projectRole) && isArchived && (
  <button
    onClick={restoreProject}
    className="w-full border border-emerald-200 text-emerald-700 rounded-lg py-2 text-left px-3 hover:bg-emerald-50"
  >
    Restore Project
  </button>
)}

          {isOwner(projectRole) && !isArchived && (
  <button
    onClick={deleteProject}
    disabled={deleting}
    className="w-full border border-red-200 text-red-600 rounded-lg py-2 text-left px-3 disabled:opacity-50"
  >
    {deleting ? "Deleting..." : "Delete Project"}
  </button>
)}

        </div>

        <div className="flex justify-between items-center pt-2">
          <span className="text-xs text-slate-400">
            Save applies to project name
          </span>

          <div className="flex gap-2">
            <button
  onClick={saveName}
  disabled={saving || !canEdit(projectRole) || isArchived}
  className="px-3 py-2 rounded-lg text-sm bg-blue-600 text-white disabled:opacity-50"
>
  {saving ? "Saving..." : "Save"}
</button>


            <button
              onClick={onClose}
              className="px-3 py-2 rounded-lg text-sm bg-slate-100"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
