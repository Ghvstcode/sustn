import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
    GripVertical,
    Circle,
    Loader2,
    GitPullRequest,
    CheckCircle2,
    XCircle,
} from "lucide-react";
import { Badge } from "@ui/components/ui/badge";
import type { Task } from "@core/types/task";

interface TaskRowProps {
    task: Task;
    onClick: () => void;
}

const categoryLabels: Record<string, string> = {
    tech_debt: "Tech Debt",
    tests: "Tests",
    docs: "Docs",
    security: "Security",
    general: "General",
};

const stateIcons: Record<string, React.ReactNode> = {
    pending: <Circle className="h-4 w-4 text-muted-foreground" />,
    in_progress: <Loader2 className="h-4 w-4 text-blue-500 animate-spin" />,
    review: <GitPullRequest className="h-4 w-4 text-amber-500" />,
    done: <CheckCircle2 className="h-4 w-4 text-green-500" />,
    dismissed: <XCircle className="h-4 w-4 text-muted-foreground/50" />,
};

export function TaskRow({ task, onClick }: TaskRowProps) {
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

    return (
        <div
            ref={setNodeRef}
            style={style}
            className={`group flex items-center gap-3 rounded-lg border border-transparent px-3 py-2.5 transition-colors hover:bg-accent/50 ${
                isDragging ? "z-50 bg-background shadow-md border-border" : ""
            } ${isDone ? "opacity-50" : ""}`}
        >
            <button
                type="button"
                className="cursor-grab touch-none text-muted-foreground/30 hover:text-muted-foreground transition-colors"
                {...attributes}
                {...listeners}
            >
                <GripVertical className="h-4 w-4" />
            </button>

            <div className="shrink-0">{stateIcons[task.state]}</div>

            <button
                type="button"
                onClick={onClick}
                className="flex flex-1 items-center gap-3 text-left min-w-0"
            >
                <span
                    className={`flex-1 truncate text-sm ${
                        isDone
                            ? "text-muted-foreground line-through"
                            : "text-foreground"
                    }`}
                >
                    {task.title}
                </span>

                {task.category !== "general" && (
                    <Badge variant="secondary" className="text-[10px] shrink-0">
                        {categoryLabels[task.category]}
                    </Badge>
                )}
            </button>
        </div>
    );
}
