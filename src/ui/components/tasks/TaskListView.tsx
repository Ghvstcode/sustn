import { useState, useMemo, useCallback } from "react";
import {
    DndContext,
    closestCenter,
    KeyboardSensor,
    PointerSensor,
    useSensor,
    useSensors,
    type DragEndEvent,
} from "@dnd-kit/core";
import {
    SortableContext,
    sortableKeyboardCoordinates,
    verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { useTasks, useCreateTask, useReorderTask } from "@core/api/useTasks";
import { useRepositories } from "@core/api/useRepositories";
import { useAppStore } from "@core/store/app-store";
import type { TaskCategory } from "@core/types/task";
import { ScrollArea } from "@ui/components/ui/scroll-area";
import { TaskListHeader } from "./TaskListHeader";
import { TaskRow } from "./TaskRow";
import { DoneTasksCollapsible } from "./DoneTasksCollapsible";
import { AddTaskDialog } from "./AddTaskDialog";
import { ListChecks } from "lucide-react";

interface TaskListViewProps {
    repositoryId: string;
}

export function TaskListView({ repositoryId }: TaskListViewProps) {
    const { data: tasks } = useTasks(repositoryId);
    const { data: repositories } = useRepositories();
    const setSelectedTask = useAppStore((s) => s.setSelectedTask);
    const createTask = useCreateTask();
    const reorderTask = useReorderTask();
    const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);

    const repo = repositories?.find((r) => r.id === repositoryId);

    const activeTasks = useMemo(
        () =>
            tasks?.filter(
                (t) => t.state !== "done" && t.state !== "dismissed",
            ) ?? [],
        [tasks],
    );

    const doneTasks = useMemo(
        () =>
            tasks?.filter(
                (t) => t.state === "done" || t.state === "dismissed",
            ) ?? [],
        [tasks],
    );

    const sensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
        useSensor(KeyboardSensor, {
            coordinateGetter: sortableKeyboardCoordinates,
        }),
    );

    const handleDragEnd = useCallback(
        (event: DragEndEvent) => {
            const { active, over } = event;
            if (!over || active.id === over.id || !activeTasks.length) return;

            const oldIndex = activeTasks.findIndex((t) => t.id === active.id);
            const newIndex = activeTasks.findIndex((t) => t.id === over.id);
            if (oldIndex === -1 || newIndex === -1) return;

            let newSortOrder: number;
            if (newIndex === 0) {
                newSortOrder = activeTasks[0].sortOrder - 1;
            } else if (newIndex === activeTasks.length - 1) {
                newSortOrder =
                    activeTasks[activeTasks.length - 1].sortOrder + 1;
            } else {
                const before =
                    newIndex > oldIndex
                        ? activeTasks[newIndex]
                        : activeTasks[newIndex - 1];
                const after =
                    newIndex > oldIndex
                        ? activeTasks[newIndex + 1]
                        : activeTasks[newIndex];
                newSortOrder = (before.sortOrder + after.sortOrder) / 2;
            }

            reorderTask.mutate({
                id: active.id as string,
                repositoryId,
                newSortOrder,
            });
        },
        [activeTasks, repositoryId, reorderTask],
    );

    function handleAddTask(task: {
        title: string;
        description?: string;
        category: TaskCategory;
    }) {
        const maxSortOrder =
            tasks && tasks.length > 0
                ? Math.max(...tasks.map((t) => t.sortOrder))
                : 0;

        createTask.mutate(
            {
                repositoryId,
                title: task.title,
                description: task.description,
                category: task.category,
                sortOrder: maxSortOrder + 1,
            },
            {
                onSuccess: () => setIsAddDialogOpen(false),
            },
        );
    }

    return (
        <div className="flex h-full flex-col">
            <TaskListHeader
                projectName={repo?.name ?? "Project"}
                onAddTask={() => setIsAddDialogOpen(true)}
            />

            <ScrollArea className="flex-1">
                <div className="px-3 py-2">
                    {activeTasks.length === 0 && doneTasks.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-16 text-center">
                            <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-border">
                                <ListChecks className="h-6 w-6 text-muted-foreground" />
                            </div>
                            <p className="mt-4 text-sm font-medium text-foreground">
                                No tasks yet
                            </p>
                            <p className="mt-1 text-xs text-muted-foreground">
                                Add your first task to get started.
                            </p>
                        </div>
                    ) : (
                        <>
                            <DndContext
                                sensors={sensors}
                                collisionDetection={closestCenter}
                                onDragEnd={handleDragEnd}
                            >
                                <SortableContext
                                    items={activeTasks.map((t) => t.id)}
                                    strategy={verticalListSortingStrategy}
                                >
                                    <div className="space-y-0.5">
                                        {activeTasks.map((task) => (
                                            <TaskRow
                                                key={task.id}
                                                task={task}
                                                onClick={() =>
                                                    setSelectedTask(task.id)
                                                }
                                            />
                                        ))}
                                    </div>
                                </SortableContext>
                            </DndContext>

                            <DoneTasksCollapsible
                                tasks={doneTasks}
                                onTaskClick={setSelectedTask}
                            />
                        </>
                    )}
                </div>
            </ScrollArea>

            <AddTaskDialog
                open={isAddDialogOpen}
                onOpenChange={setIsAddDialogOpen}
                onSubmit={handleAddTask}
                isPending={createTask.isPending}
            />
        </div>
    );
}
