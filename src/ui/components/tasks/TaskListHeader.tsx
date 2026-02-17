import { Plus } from "lucide-react";
import { Button } from "@ui/components/ui/button";

interface TaskListHeaderProps {
    projectName: string;
    onAddTask: () => void;
}

export function TaskListHeader({
    projectName,
    onAddTask,
}: TaskListHeaderProps) {
    return (
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
            <h2 className="text-lg font-semibold text-foreground">
                {projectName}
            </h2>
            <Button
                size="sm"
                variant="outline"
                className="gap-1.5"
                onClick={onAddTask}
            >
                <Plus className="h-3.5 w-3.5" />
                Add Task
            </Button>
        </div>
    );
}
