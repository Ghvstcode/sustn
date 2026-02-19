import type { Task } from "@core/types/task";

interface TaskOverviewProps {
    task: Task;
}

export function TaskOverview({ task }: TaskOverviewProps) {
    if (!task.description) {
        return (
            <div className="rounded-lg border border-border bg-muted/30 p-4">
                <p className="text-xs text-muted-foreground/70">
                    No description yet. The agent will generate a detailed
                    analysis when it scans or works on this task.
                </p>
            </div>
        );
    }

    return (
        <div>
            <h3 className="text-sm font-medium text-foreground mb-2">
                Description
            </h3>
            <div className="text-sm text-foreground/90 leading-relaxed whitespace-pre-wrap">
                {task.description}
            </div>
        </div>
    );
}
