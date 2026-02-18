import { useTask, useUpdateTask, useDeleteTask } from "@core/api/useTasks";
import { useAppStore } from "@core/store/app-store";
import { Separator } from "@ui/components/ui/separator";
import type { TaskState } from "@core/types/task";
import { TaskDetailHeader } from "./TaskDetailHeader";
import { TaskOverview } from "./TaskOverview";
import { TaskNotes } from "./TaskNotes";
import { TaskActions } from "./TaskActions";
import { TaskReviewPanel } from "./TaskReviewPanel";
import { TaskHistory } from "./TaskHistory";

interface TaskDetailViewProps {
    taskId: string;
}

export function TaskDetailView({ taskId }: TaskDetailViewProps) {
    const { data: task, isLoading } = useTask(taskId);
    const updateTask = useUpdateTask();
    const deleteTask = useDeleteTask();
    const setSelectedTask = useAppStore((s) => s.setSelectedTask);

    if (isLoading || !task) {
        return (
            <div className="flex h-full items-center justify-center">
                <p className="text-sm text-muted-foreground">Loading...</p>
            </div>
        );
    }

    function handleUpdateState(state: TaskState) {
        updateTask.mutate({ id: taskId, state });
    }

    function handleUpdateTitle(title: string) {
        updateTask.mutate({ id: taskId, title });
    }

    function handleSaveNotes(notes: string) {
        updateTask.mutate({ id: taskId, notes });
    }

    function handleSavePrUrl(prUrl: string) {
        updateTask.mutate({ id: taskId, prUrl });
    }

    function handleDelete() {
        deleteTask.mutate(
            { id: taskId, repositoryId: task!.repositoryId },
            { onSuccess: () => setSelectedTask(undefined) },
        );
    }

    return (
        <div className="flex h-full flex-col">
            <TaskDetailHeader
                task={task}
                onBack={() => setSelectedTask(undefined)}
                onUpdateTitle={handleUpdateTitle}
                onUpdateState={handleUpdateState}
                onDelete={handleDelete}
            />

            <div className="flex-1 overflow-y-auto">
                <div className="min-h-full flex flex-col justify-center">
                    <div className="mx-auto w-full max-w-2xl space-y-6 px-6 py-5">
                        <TaskOverview task={task} />

                        <Separator />

                        <TaskActions
                            state={task.state}
                            onUpdateState={handleUpdateState}
                        />

                        {(task.state === "review" || task.prUrl) && (
                            <>
                                <Separator />
                                <TaskReviewPanel
                                    prUrl={task.prUrl}
                                    onSavePrUrl={handleSavePrUrl}
                                />
                            </>
                        )}

                        <Separator />

                        <TaskNotes
                            notes={task.notes}
                            onSave={handleSaveNotes}
                        />

                        <Separator />

                        <TaskHistory taskId={taskId} />
                    </div>
                </div>
            </div>
        </div>
    );
}
