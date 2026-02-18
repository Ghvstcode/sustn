import type { Repository } from "@core/db/repositories";
import { useTasks } from "@core/api/useTasks";

interface ProjectItemProps {
    repository: Repository;
    isSelected: boolean;
    onSelect: () => void;
}

export function ProjectItem({
    repository,
    isSelected,
    onSelect,
}: ProjectItemProps) {
    const { data: tasks } = useTasks(repository.id);
    const initial = repository.name.charAt(0).toUpperCase();
    const activeCount =
        tasks?.filter((t) => t.state !== "done" && t.state !== "dismissed")
            .length ?? 0;

    return (
        <button
            type="button"
            onClick={onSelect}
            className={`flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-all ${
                isSelected
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-sidebar-foreground hover:bg-sidebar-accent/50"
            }`}
        >
            <span
                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[11px] font-semibold transition-colors ${
                    isSelected
                        ? "bg-sidebar-foreground text-sidebar"
                        : "bg-sidebar-accent text-sidebar-foreground"
                }`}
            >
                {initial}
            </span>
            <span className="flex-1 truncate text-[13px] font-medium">
                {repository.name}
            </span>
            {activeCount > 0 && (
                <span
                    className={`shrink-0 text-[10px] tabular-nums ${
                        isSelected
                            ? "text-sidebar-accent-foreground"
                            : "text-sidebar-foreground"
                    }`}
                >
                    {activeCount}
                </span>
            )}
        </button>
    );
}
