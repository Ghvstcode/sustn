import { useAppStore } from "@core/store/app-store";
import { EmptyState } from "./EmptyState";
import { TaskListView } from "@ui/components/tasks/TaskListView";
import { TaskDetailView } from "@ui/components/tasks/TaskDetailView";

export function MainContent() {
    const selectedRepositoryId = useAppStore((s) => s.selectedRepositoryId);
    const selectedTaskId = useAppStore((s) => s.selectedTaskId);

    if (!selectedRepositoryId) {
        return <EmptyState />;
    }

    if (selectedTaskId) {
        return <TaskDetailView taskId={selectedTaskId} />;
    }

    return <TaskListView repositoryId={selectedRepositoryId} />;
}
