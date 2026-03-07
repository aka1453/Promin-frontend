"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../lib/supabaseClient";
import { useToast } from "./ToastProvider";
import { Copy, Loader2, LayoutTemplate } from "lucide-react";

type TemplateProject = {
  id: number;
  name: string;
  description: string | null;
  planned_start: string | null;
};

export default function AddProjectButton({ onCreated }: { onCreated: () => void }) {
  const router = useRouter();
  const { pushToast } = useToast();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"blank" | "template">("blank");

  // Blank project state
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  // Template state
  const [templates, setTemplates] = useState<TemplateProject[]>([]);
  const [loadingTemplates, setLoadingTemplates] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<TemplateProject | null>(null);
  const [templateName, setTemplateName] = useState("");
  const [templateStartDate, setTemplateStartDate] = useState(() => {
    return new Date().toISOString().split("T")[0];
  });
  const [cloning, setCloning] = useState(false);

  // Load templates when switching to template mode
  useEffect(() => {
    if (!open || mode !== "template") return;
    async function load() {
      setLoadingTemplates(true);
      const { data } = await supabase
        .from("projects")
        .select("id, name, description, planned_start")
        .eq("is_template", true)
        .order("name", { ascending: true });
      setTemplates((data as TemplateProject[]) ?? []);
      setLoadingTemplates(false);
    }
    load();
  }, [open, mode]);

  function resetAndClose() {
    setName("");
    setDescription("");
    setMode("blank");
    setSelectedTemplate(null);
    setTemplateName("");
    setTemplateStartDate(new Date().toISOString().split("T")[0]);
    setOpen(false);
  }

  async function createProject() {
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      alert("You must be logged in to create a project");
      return;
    }

    const { data: minPosData, error: minPosError } = await supabase
      .from("projects")
      .select("position")
      .order("position", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (minPosError) {
      alert("Failed to determine project position");
      return;
    }

    const newPosition =
      minPosData?.position != null ? minPosData.position - 1 : 0;

    const { error } = await supabase.from("projects").insert({
      name,
      description,
      project_manager_id: user.id,
      owner_id: user.id,
      position: newPosition,
    });

    if (error) {
      alert("Error creating project");
      return;
    }

    resetAndClose();
    onCreated();
  }

  async function cloneFromTemplate() {
    if (!selectedTemplate) return;
    if (!templateName.trim()) return;

    setCloning(true);

    try {
      const { data, error } = await supabase.rpc("clone_project", {
        p_source_id: selectedTemplate.id,
        p_new_name: templateName.trim(),
        p_new_start_date: templateStartDate || null,
      });

      if (error) {
        alert(error.message);
        setCloning(false);
        return;
      }

      if (!data?.ok) {
        alert(data?.error || "Clone failed");
        setCloning(false);
        return;
      }

      const totalEntities =
        (data.milestones_created || 0) +
        (data.tasks_created || 0) +
        (data.deliverables_created || 0);

      pushToast(`Project created from template — ${totalEntities} entities`, "success");

      resetAndClose();
      onCreated();

      if (data.new_project_id) {
        router.push(`/projects/${data.new_project_id}`);
      }
    } catch (err: any) {
      alert(err?.message || "Unexpected error");
    } finally {
      setCloning(false);
    }
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="px-4 py-2 bg-blue-600 text-white rounded"
      >
        + Add Project
      </button>

      {open && (
        <div
          className="fixed inset-0 bg-black/40 flex items-center justify-center z-50"
          onClick={resetAndClose}
        >
          <div
            className="bg-white p-6 rounded-xl w-[400px] shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-semibold mb-4">New Project</h2>

            {/* Mode Toggle */}
            <div className="flex rounded-lg bg-slate-100 p-1 mb-5">
              <button
                onClick={() => { setMode("blank"); setSelectedTemplate(null); }}
                className={`flex-1 text-sm font-medium py-1.5 rounded-md transition ${
                  mode === "blank"
                    ? "bg-white text-slate-900 shadow-sm"
                    : "text-slate-500 hover:text-slate-700"
                }`}
              >
                Blank
              </button>
              <button
                onClick={() => setMode("template")}
                className={`flex-1 flex items-center justify-center gap-1.5 text-sm font-medium py-1.5 rounded-md transition ${
                  mode === "template"
                    ? "bg-white text-slate-900 shadow-sm"
                    : "text-slate-500 hover:text-slate-700"
                }`}
              >
                <LayoutTemplate size={14} />
                From Template
              </button>
            </div>

            {/* Blank Project Form */}
            {mode === "blank" && (
              <>
                <input
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm mb-3 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Project name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoFocus
                />

                <textarea
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm mb-4 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Description (optional)"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={2}
                />

                <div className="flex justify-end gap-2">
                  <button
                    className="px-3 py-2 rounded-lg text-sm bg-slate-100 hover:bg-slate-200 transition"
                    onClick={resetAndClose}
                  >
                    Cancel
                  </button>
                  <button
                    className="px-3 py-2 rounded-lg text-sm bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 transition"
                    onClick={createProject}
                    disabled={!name.trim()}
                  >
                    Create
                  </button>
                </div>
              </>
            )}

            {/* From Template Form */}
            {mode === "template" && (
              <>
                {loadingTemplates ? (
                  <div className="flex items-center justify-center py-8 text-slate-400">
                    <Loader2 size={20} className="animate-spin mr-2" />
                    Loading templates...
                  </div>
                ) : templates.length === 0 ? (
                  <div className="py-8 text-center">
                    <LayoutTemplate size={28} className="mx-auto text-slate-300 mb-2" />
                    <p className="text-sm text-slate-500 mb-1">No templates yet</p>
                    <p className="text-xs text-slate-400">
                      Save a project as a template from its Settings menu
                    </p>
                  </div>
                ) : !selectedTemplate ? (
                  /* Template selector */
                  <div className="space-y-1.5 max-h-[280px] overflow-y-auto">
                    {templates.map((t) => (
                      <button
                        key={t.id}
                        onClick={() => {
                          setSelectedTemplate(t);
                          setTemplateName(`Copy of ${t.name}`);
                        }}
                        className="w-full text-left px-3 py-2.5 rounded-lg border border-slate-150 hover:border-blue-300 hover:bg-blue-50 transition group"
                      >
                        <div className="flex items-center gap-2">
                          <LayoutTemplate size={14} className="text-slate-400 group-hover:text-blue-500 shrink-0" />
                          <span className="text-sm font-medium text-slate-700 group-hover:text-blue-700 truncate">
                            {t.name}
                          </span>
                        </div>
                        {t.description && (
                          <p className="text-xs text-slate-400 mt-0.5 ml-[22px] line-clamp-1">
                            {t.description}
                          </p>
                        )}
                      </button>
                    ))}
                  </div>
                ) : (
                  /* Selected template — name + start date */
                  <>
                    <div className="px-3 py-2 rounded-lg bg-slate-50 border border-slate-100 mb-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <span className="text-xs text-slate-400">Template</span>
                          <p className="text-sm font-medium text-slate-700 truncate">
                            {selectedTemplate.name}
                          </p>
                        </div>
                        <button
                          onClick={() => setSelectedTemplate(null)}
                          className="text-xs text-blue-600 hover:text-blue-800"
                        >
                          Change
                        </button>
                      </div>
                    </div>

                    <div className="mb-3">
                      <label className="block text-xs font-medium text-slate-500 mb-1">
                        New project name
                      </label>
                      <input
                        type="text"
                        value={templateName}
                        onChange={(e) => setTemplateName(e.target.value)}
                        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        autoFocus
                        disabled={cloning}
                      />
                    </div>

                    <div className="mb-4">
                      <label className="block text-xs font-medium text-slate-500 mb-1">
                        Project start date
                      </label>
                      <input
                        type="date"
                        value={templateStartDate}
                        onChange={(e) => setTemplateStartDate(e.target.value)}
                        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        disabled={cloning}
                      />
                      <p className="text-[11px] text-slate-400 mt-1">
                        All dates shift relative to this start date
                      </p>
                    </div>

                    <div className="flex justify-end gap-2">
                      <button
                        className="px-3 py-2 rounded-lg text-sm bg-slate-100 hover:bg-slate-200 transition"
                        onClick={resetAndClose}
                        disabled={cloning}
                      >
                        Cancel
                      </button>
                      <button
                        className="px-3 py-2 rounded-lg text-sm bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 transition flex items-center gap-2"
                        onClick={cloneFromTemplate}
                        disabled={cloning || !templateName.trim()}
                      >
                        {cloning ? (
                          <>
                            <Loader2 size={14} className="animate-spin" />
                            Creating...
                          </>
                        ) : (
                          <>
                            <Copy size={14} />
                            Create from Template
                          </>
                        )}
                      </button>
                    </div>
                  </>
                )}

                {/* Cancel for template selector view (no template selected) */}
                {!selectedTemplate && templates.length > 0 && (
                  <div className="flex justify-end mt-4">
                    <button
                      className="px-3 py-2 rounded-lg text-sm bg-slate-100 hover:bg-slate-200 transition"
                      onClick={resetAndClose}
                    >
                      Cancel
                    </button>
                  </div>
                )}

                {/* Cancel for empty templates */}
                {templates.length === 0 && !loadingTemplates && (
                  <div className="flex justify-end mt-4">
                    <button
                      className="px-3 py-2 rounded-lg text-sm bg-slate-100 hover:bg-slate-200 transition"
                      onClick={resetAndClose}
                    >
                      Cancel
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
