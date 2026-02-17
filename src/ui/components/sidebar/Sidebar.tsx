import { useState } from "react";
import { Plus } from "lucide-react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { useAddRepository } from "@core/api/useRepositories";
import { useAppStore } from "@core/store/app-store";
import { ProjectList } from "./ProjectList";
import { SidebarFooter } from "./SidebarFooter";

export function Sidebar() {
    const addRepo = useAddRepository();
    const setSelectedRepository = useAppStore((s) => s.setSelectedRepository);
    const [error, setError] = useState<string | undefined>(undefined);

    async function handleAddProject() {
        setError(undefined);

        const selected = await openDialog({
            directory: true,
            multiple: false,
            title: "Select a project directory",
        });

        if (!selected) return;

        const path = typeof selected === "string" ? selected : selected[0];
        if (!path) return;

        const name = path.split("/").pop() ?? "unknown";

        addRepo.mutate(
            { path, name },
            {
                onSuccess: (repo) => setSelectedRepository(repo.id),
                onError: (err: Error) => setError(err.message),
            },
        );
    }

    return (
        <aside className="flex w-64 flex-col border-r border-border bg-sidebar">
            {/* Header */}
            <div className="flex items-center justify-between p-4 pb-3">
                <h1 className="text-lg font-semibold text-sidebar-foreground">
                    sustn
                </h1>
            </div>

            {/* Projects section */}
            <div className="flex items-center justify-between px-4 pb-1">
                <span className="text-[11px] font-medium uppercase tracking-wider text-sidebar-foreground/40">
                    Projects
                </span>
                <button
                    type="button"
                    onClick={() => void handleAddProject()}
                    disabled={addRepo.isPending}
                    className="rounded-md p-0.5 text-sidebar-foreground/40 hover:bg-sidebar-accent hover:text-sidebar-foreground transition-colors"
                    title="Add project"
                >
                    <Plus className="h-3.5 w-3.5" />
                </button>
            </div>

            {error && (
                <p className="px-4 py-1 text-xs text-destructive">{error}</p>
            )}

            {/* Project list */}
            <div className="flex-1 overflow-hidden">
                <ProjectList />
            </div>

            {/* Footer */}
            <SidebarFooter />
        </aside>
    );
}
