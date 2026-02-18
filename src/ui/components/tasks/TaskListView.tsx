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
import {
    useTasks,
    useCreateTask,
    useReorderTask,
    useDeleteTask,
} from "@core/api/useTasks";
import { useRepositories } from "@core/api/useRepositories";
import { useAppStore } from "@core/store/app-store";
import type { TaskCategory } from "@core/types/task";
import { TaskListHeader } from "./TaskListHeader";
import { TaskRow } from "./TaskRow";
import { AddTaskDialog } from "./AddTaskDialog";

interface TaskListViewProps {
    repositoryId: string;
}

export function TaskListView({ repositoryId }: TaskListViewProps) {
    const { data: tasks } = useTasks(repositoryId);
    const { data: repositories } = useRepositories();
    const setSelectedTask = useAppStore((s) => s.setSelectedTask);
    const createTask = useCreateTask();
    const reorderTask = useReorderTask();
    const deleteTask = useDeleteTask();
    const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
    const [hoveredTaskId, setHoveredTaskId] = useState<string | null>(null);

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

    function handleMoveUp(taskId: string) {
        const idx = activeTasks.findIndex((t) => t.id === taskId);
        if (idx <= 0) return;
        const prev = activeTasks[idx - 1];
        const beforePrev = idx >= 2 ? activeTasks[idx - 2] : null;
        const newSort = beforePrev
            ? (beforePrev.sortOrder + prev.sortOrder) / 2
            : prev.sortOrder - 1;
        reorderTask.mutate({ id: taskId, repositoryId, newSortOrder: newSort });
    }

    function handleMoveDown(taskId: string) {
        const idx = activeTasks.findIndex((t) => t.id === taskId);
        if (idx === -1 || idx >= activeTasks.length - 1) return;
        const next = activeTasks[idx + 1];
        const afterNext =
            idx + 2 < activeTasks.length ? activeTasks[idx + 2] : null;
        const newSort = afterNext
            ? (next.sortOrder + afterNext.sortOrder) / 2
            : next.sortOrder + 1;
        reorderTask.mutate({ id: taskId, repositoryId, newSortOrder: newSort });
    }

    function handleDeleteTask(taskId: string) {
        deleteTask.mutate({ id: taskId, repositoryId });
    }

    return (
        <div className="flex h-full flex-col">
            <TaskListHeader
                projectName={repo?.name ?? "Project"}
                repositoryId={repositoryId}
                repositoryPath={repo?.path ?? ""}
                lastPulledAt={repo?.lastPulledAt}
                onAddTask={() => setIsAddDialogOpen(true)}
            />

            {activeTasks.length === 0 && doneTasks.length === 0 ? (
                <div className="flex flex-1 flex-col items-center pt-[28vh] text-center px-6">
                    {/* Spinning logo */}
                    <div className="animate-fade-in-up">
                        <svg
                            width="36"
                            height="36"
                            viewBox="0 0 42 42"
                            fill="none"
                            xmlns="http://www.w3.org/2000/svg"
                            className="animate-slow-spin text-foreground/15"
                        >
                            <path
                                d="M24.3012 1.73511V19.0934M24.3012 36.4518V19.0934M36.5754 6.81925L12.027 31.3676M24.3012 19.0934L6.94287 19.0934M36.5754 31.3676L12.027 6.81925"
                                stroke="currentColor"
                                strokeWidth="3"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                            />
                        </svg>
                    </div>

                    <p className="mt-5 text-sm font-medium text-foreground animate-fade-in-up delay-100">
                        Scanning your codebase
                    </p>

                    {/* Scanning steps */}
                    <div className="mt-5 flex flex-col items-start gap-2.5 text-left">
                        <div
                            className="flex items-center gap-2 animate-fade-in-up"
                            style={{ animationDelay: "300ms" }}
                        >
                            <span className="h-1 w-1 rounded-full bg-foreground/40" />
                            <span className="text-xs text-muted-foreground">
                                Reading project structure
                            </span>
                        </div>
                        <div
                            className="flex items-center gap-2 animate-fade-in-up"
                            style={{ animationDelay: "600ms" }}
                        >
                            <span className="h-1 w-1 rounded-full bg-foreground/40" />
                            <span className="text-xs text-muted-foreground">
                                Analyzing recent commits
                            </span>
                        </div>
                        <div
                            className="flex items-center gap-2 animate-fade-in-up"
                            style={{ animationDelay: "900ms" }}
                        >
                            <span className="h-1 w-1 rounded-full bg-foreground/40" />
                            <span className="text-xs text-muted-foreground">
                                Identifying improvements
                            </span>
                        </div>
                        <div
                            className="flex items-center gap-2 animate-fade-in-up"
                            style={{ animationDelay: "1200ms" }}
                        >
                            <span className="h-1 w-1 rounded-full bg-foreground/40" />
                            <span className="text-xs text-muted-foreground">
                                Generating tasks...
                            </span>
                        </div>
                    </div>

                    {/* Indeterminate progress */}
                    <div
                        className="w-36 h-px bg-border rounded-full overflow-hidden mt-6 animate-fade-in-up"
                        style={{ animationDelay: "1500ms" }}
                    >
                        <div className="h-full w-1/3 bg-foreground/30 rounded-full animate-slide-indeterminate" />
                    </div>
                </div>
            ) : (
                <div
                    className="flex-1 overflow-y-auto"
                    onMouseLeave={() => setHoveredTaskId(null)}
                >
                    <div className="mx-auto w-full max-w-2xl px-6 pt-[28vh] pb-8">
                        <DndContext
                            sensors={sensors}
                            collisionDetection={closestCenter}
                            onDragEnd={handleDragEnd}
                        >
                            <SortableContext
                                items={activeTasks.map((t) => t.id)}
                                strategy={verticalListSortingStrategy}
                            >
                                {activeTasks.map((task, idx) => (
                                    <TaskRow
                                        key={task.id}
                                        task={task}
                                        onClick={() => setSelectedTask(task.id)}
                                        onMoveUp={() => handleMoveUp(task.id)}
                                        onMoveDown={() =>
                                            handleMoveDown(task.id)
                                        }
                                        onDelete={() =>
                                            handleDeleteTask(task.id)
                                        }
                                        canMoveUp={idx > 0}
                                        canMoveDown={
                                            idx < activeTasks.length - 1
                                        }
                                        isActive={hoveredTaskId === task.id}
                                        onHover={() =>
                                            setHoveredTaskId(task.id)
                                        }
                                    />
                                ))}
                            </SortableContext>
                        </DndContext>

                        {doneTasks.map((task) => (
                            <TaskRow
                                key={task.id}
                                task={task}
                                onClick={() => setSelectedTask(task.id)}
                                onDelete={() => handleDeleteTask(task.id)}
                                isActive={hoveredTaskId === task.id}
                                onHover={() => setHoveredTaskId(task.id)}
                            />
                        ))}
                    </div>
                </div>
            )}

            <AddTaskDialog
                open={isAddDialogOpen}
                onOpenChange={setIsAddDialogOpen}
                onSubmit={handleAddTask}
                isPending={createTask.isPending}
            />
        </div>
    );
}
