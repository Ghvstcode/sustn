import { useRepositories } from "@core/api/useRepositories";
import { useAppStore } from "@core/store/app-store";
import { ProjectItem } from "./ProjectItem";
import { ScrollArea } from "@ui/components/ui/scroll-area";

export function ProjectList() {
    const { data: repositories } = useRepositories();
    const selectedRepositoryId = useAppStore((s) => s.selectedRepositoryId);
    const setSelectedRepository = useAppStore((s) => s.setSelectedRepository);

    if (!repositories || repositories.length === 0) {
        return (
            <p className="px-3 py-2 text-xs text-sidebar-foreground/40">
                No projects yet
            </p>
        );
    }

    return (
        <ScrollArea className="flex-1">
            <div className="space-y-0.5 px-2">
                {repositories.map((repo) => (
                    <ProjectItem
                        key={repo.id}
                        repository={repo}
                        isSelected={selectedRepositoryId === repo.id}
                        onSelect={() => setSelectedRepository(repo.id)}
                    />
                ))}
            </div>
        </ScrollArea>
    );
}
