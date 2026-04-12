import { useState } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
    GripVertical,
    Circle,
    CheckCircle2,
    Loader2,
    GitPullRequest,
    XCircle,
    Pencil,
    MessageSquare,
    Clock,
} from "lucide-react";
import { Badge } from "@ui/components/ui/badge";
import { useUpdateTask } from "@core/api/useTasks";
import type { Task, TaskCategory } from "@core/types/task";
import { TaskRowActions } from "./TaskRowActions";
import { InlineCommentInput } from "./InlineCommentInput";
import { InlineTaskEditor } from "./InlineTaskEditor";

interface TaskRowProps {
    task: Task;
    onClick: () => void;
    onMoveUp?: () => void;
    onMoveDown?: () => void;
    onDelete?: () => void;
    canMoveUp?: boolean;
    canMoveDown?: boolean;
    isActive?: boolean;
    onHover?: () => void;
    isQueued?: boolean;
    queuePosition?: number;
}

const categoryLabels: Record<string, string> = {
    tech_debt: "Tech Debt",
    tests: "Tests",
    docs: "Docs",
    security: "Security",
    feature: "Feature",
    performance: "Performance",
    dx: "DX",
    observability: "Observability",
    general: "General",
};

const statePrefix: Record<string, string | undefined> = {
    pending: undefined,
    in_progress: "In-Progress",
    review: "Awaiting Review",
    done: "Done",
    dismissed: "Dismissed",
};

export function TaskRow({
    task,
    onClick,
    onMoveUp,
    onMoveDown,
    onDelete,
    canMoveUp = false,
    canMoveDown = false,
    isActive = false,
    onHover,
    isQueued = false,
    queuePosition = -1,
}: TaskRowProps) {
    const updateTask = useUpdateTask();
    const [isEditing, setIsEditing] = useState(false);
    const [showComment, setShowComment] = useState(false);
    const [isMenuOpen, setIsMenuOpen] = useState(false);

    const showActions = isActive || isMenuOpen;

    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition,
        isDragging,
    } = useSortable({ id: task.id });

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
    };

    const isDone = task.state === "done" || task.state === "dismissed";
    const prefix = isQueued
        ? queuePosition === 0
            ? "Up Next"
            : `Queued #${queuePosition + 1}`
        : statePrefix[task.state];

    function handleToggleDone(e: React.MouseEvent) {
        e.stopPropagation();
        updateTask.mutate({
            id: task.id,
            state: isDone ? "pending" : "done",
        });
    }

    function handleStartEdit(e?: React.MouseEvent) {
        e?.stopPropagation();
        setIsEditing(true);
    }

    function handleSaveInlineEdit(fields: {
        title: string;
        description?: string;
        category: TaskCategory;
    }) {
        updateTask.mutate({
            id: task.id,
            title: fields.title,
            description: fields.description,
            category: fields.category,
        });
        setIsEditing(false);
    }

    function handleToggleComment(e: React.MouseEvent) {
        e.stopPropagation();
        setShowComment((prev) => !prev);
    }

    const stateIcon = (() => {
        if (isQueued) {
            return (
                <span className="shrink-0" aria-label="Queued">
                    <Clock className="h-4 w-4 text-violet-500" />
                </span>
            );
        }

        switch (task.state) {
            case "pending":
                return (
                    <button
                        type="button"
                        onClick={handleToggleDone}
                        aria-label="Mark as done"
                        className="group/circle shrink-0"
                    >
                        <Circle className="h-4 w-4 text-muted-foreground/40 transition-colors group-hover/circle:text-green-500" />
                    </button>
                );
            case "in_progress":
                return (
                    <button
                        type="button"
                        onClick={handleToggleDone}
                        aria-label="Mark as done (currently in progress)"
                        className="group/circle shrink-0"
                    >
                        <Loader2 className="h-4 w-4 text-blue-500 animate-spin transition-colors group-hover/circle:text-green-500 group-hover/circle:animate-none" />
                    </button>
                );
            case "review":
                return (
                    <button
                        type="button"
                        onClick={handleToggleDone}
                        aria-label="Mark as done (currently awaiting review)"
                        className="group/circle shrink-0"
                    >
                        <GitPullRequest className="h-4 w-4 text-amber-500 transition-colors group-hover/circle:text-green-500" />
                    </button>
                );
            case "done":
                return (
                    <button
                        type="button"
                        onClick={handleToggleDone}
                        aria-label="Mark as pending (currently done)"
                        className="shrink-0"
                    >
                        <CheckCircle2 className="h-4 w-4 text-green-500" />
                    </button>
                );
            case "dismissed":
                return (
                    <button
                        type="button"
                        onClick={handleToggleDone}
                        aria-label="Mark as pending (currently dismissed)"
                        className="shrink-0"
                    >
                        <XCircle className="h-4 w-4 text-muted-foreground/50" />
                    </button>
                );
        }
    })();

    return (
        <div>
            <div
                ref={setNodeRef}
                style={style}
                onMouseEnter={onHover}
                className={`flex items-start gap-3 border-b border-border px-3 py-3 ${
                    isDragging ? "z-50 bg-background shadow-md" : ""
                } ${isDone ? "opacity-50" : ""}`}
            >
                {/* Drag handle — only rendered on hover to avoid CSS issues */}
                {showActions ? (
                    <button
                        type="button"
                        aria-label="Drag to reorder"
                        className="mt-0.5 cursor-grab touch-none text-muted-foreground/30 hover:text-muted-foreground"
                        {...attributes}
                        {...listeners}
                    >
                        <GripVertical className="h-4 w-4" />
                    </button>
                ) : (
                    <div className="w-4 shrink-0" />
                )}

                {/* State icon / toggle */}
                <div className="mt-0.5">{stateIcon}</div>

                {/* Content area */}
                {isEditing ? (
                    <div className="flex-1 min-w-0">
                        <InlineTaskEditor
                            task={task}
                            onSave={handleSaveInlineEdit}
                            onCancel={() => setIsEditing(false)}
                        />
                    </div>
                ) : (
                    <button
                        type="button"
                        onClick={onClick}
                        className="flex flex-1 flex-col gap-0.5 text-left min-w-0"
                    >
                        <div className="flex items-center gap-2 w-full">
                            <span
                                className={`flex-1 truncate text-sm ${
                                    isDone
                                        ? "text-muted-foreground line-through"
                                        : "text-foreground"
                                }`}
                            >
                                {prefix && (
                                    <span className="text-muted-foreground font-medium">
                                        [{prefix}]{" "}
                                    </span>
                                )}
                                {task.title}
                            </span>

                            {/* Diff stats */}
                            {task.linesAdded != null && (
                                <span className="shrink-0 text-[11px] font-mono text-green-600">
                                    +{task.linesAdded}
                                </span>
                            )}
                            {task.linesRemoved != null && (
                                <span className="shrink-0 text-[11px] font-mono text-red-500">
                                    -{task.linesRemoved}
                                </span>
                            )}

                            {task.category !== "general" &&
                                categoryLabels[task.category] && (
                                    <Badge
                                        variant="secondary"
                                        className="text-[10px] shrink-0"
                                    >
                                        {categoryLabels[task.category]}
                                    </Badge>
                                )}
                        </div>

                        <span className="truncate text-xs text-muted-foreground/60">
                            {task.description || "No description"}
                        </span>
                    </button>
                )}

                {/* Hover action bar — conditionally rendered */}
                {showActions && !isEditing && (
                    <div className="mt-0.5 flex items-center gap-0.5">
                        <button
                            type="button"
                            aria-label="Edit task"
                            className="rounded-md p-1 text-muted-foreground/50 hover:text-foreground hover:bg-accent transition-colors"
                            onClick={handleStartEdit}
                        >
                            <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                            type="button"
                            aria-label="Add comment"
                            className="rounded-md p-1 text-muted-foreground/50 hover:text-foreground hover:bg-accent transition-colors"
                            onClick={handleToggleComment}
                        >
                            <MessageSquare className="h-3.5 w-3.5" />
                        </button>
                        <TaskRowActions
                            onMoveUp={onMoveUp ?? (() => {})}
                            onMoveDown={onMoveDown ?? (() => {})}
                            onEdit={handleStartEdit}
                            onDelete={onDelete ?? (() => {})}
                            canMoveUp={canMoveUp}
                            canMoveDown={canMoveDown}
                            onOpenChange={setIsMenuOpen}
                        />
                    </div>
                )}
            </div>

            {/* Inline comment input */}
            {showComment && (
                <InlineCommentInput
                    taskId={task.id}
                    onClose={() => setShowComment(false)}
                />
            )}
        </div>
    );
}
