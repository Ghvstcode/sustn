import { useState } from "react";
import { ArrowLeft, Trash2 } from "lucide-react";
import { Button } from "@ui/components/ui/button";
import { Input } from "@ui/components/ui/input";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@ui/components/ui/select";
import type { Task, TaskState } from "@core/types/task";

interface TaskDetailHeaderProps {
    task: Task;
    onBack: () => void;
    onUpdateTitle: (title: string) => void;
    onUpdateState: (state: TaskState) => void;
    onDelete: () => void;
}

const stateLabels: Record<TaskState, string> = {
    pending: "Pending",
    in_progress: "In Progress",
    review: "Review",
    done: "Done",
    dismissed: "Dismissed",
};

export function TaskDetailHeader({
    task,
    onBack,
    onUpdateTitle,
    onUpdateState,
    onDelete,
}: TaskDetailHeaderProps) {
    const [isEditingTitle, setIsEditingTitle] = useState(false);
    const [titleDraft, setTitleDraft] = useState(task.title);

    function handleTitleSubmit() {
        const trimmed = titleDraft.trim();
        if (trimmed && trimmed !== task.title) {
            onUpdateTitle(trimmed);
        } else {
            setTitleDraft(task.title);
        }
        setIsEditingTitle(false);
    }

    return (
        <div className="flex items-center gap-3 border-b border-border px-6 py-4">
            <Button
                variant="ghost"
                size="sm"
                className="shrink-0 -ml-2"
                onClick={onBack}
            >
                <ArrowLeft className="h-4 w-4" />
            </Button>

            <div className="flex-1 min-w-0">
                {isEditingTitle ? (
                    <Input
                        value={titleDraft}
                        onChange={(e) => setTitleDraft(e.target.value)}
                        onBlur={handleTitleSubmit}
                        onKeyDown={(e) => {
                            if (e.key === "Enter") handleTitleSubmit();
                            if (e.key === "Escape") {
                                setTitleDraft(task.title);
                                setIsEditingTitle(false);
                            }
                        }}
                        autoFocus
                        className="text-lg font-semibold"
                    />
                ) : (
                    <button
                        type="button"
                        onClick={() => setIsEditingTitle(true)}
                        className="text-lg font-semibold text-foreground text-left truncate block w-full hover:text-foreground/80 transition-colors"
                    >
                        {task.title}
                    </button>
                )}
            </div>

            <Select
                value={task.state}
                onValueChange={(v) => onUpdateState(v as TaskState)}
            >
                <SelectTrigger className="w-[140px] shrink-0">
                    <SelectValue />
                </SelectTrigger>
                <SelectContent>
                    {(Object.entries(stateLabels) as [TaskState, string][]).map(
                        ([value, label]) => (
                            <SelectItem key={value} value={value}>
                                {label}
                            </SelectItem>
                        ),
                    )}
                </SelectContent>
            </Select>

            <Button
                variant="ghost"
                size="sm"
                className="shrink-0 text-muted-foreground hover:text-destructive"
                onClick={onDelete}
            >
                <Trash2 className="h-4 w-4" />
            </Button>
        </div>
    );
}
