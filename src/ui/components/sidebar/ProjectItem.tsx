import { FolderGit2 } from "lucide-react";
import type { Repository } from "@core/db/repositories";

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
    return (
        <button
            type="button"
            onClick={onSelect}
            className={`flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-sm transition-colors ${
                isSelected
                    ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                    : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
            }`}
        >
            <FolderGit2 className="h-4 w-4 shrink-0" />
            <span className="truncate">{repository.name}</span>
        </button>
    );
}
