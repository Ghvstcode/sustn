import { useMemo } from "react";
import { Plus, ArrowDownToLine, Loader2 } from "lucide-react";
import { Button } from "@ui/components/ui/button";
import { useGitPull } from "@core/api/useRepositories";

interface TaskListHeaderProps {
    projectName: string;
    repositoryId: string;
    repositoryPath: string;
    lastPulledAt: string | undefined;
    onAddTask: () => void;
}

function formatRelativeTime(dateStr: string): string {
    const now = Date.now();
    const then = new Date(dateStr + "Z").getTime(); // SQLite CURRENT_TIMESTAMP is UTC
    const diffMs = now - then;

    if (diffMs < 0) return "just now";

    const seconds = Math.floor(diffMs / 1000);
    if (seconds < 60) return "just now";

    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;

    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;

    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d ago`;

    const weeks = Math.floor(days / 7);
    return `${weeks}w ago`;
}

export function TaskListHeader({
    projectName,
    repositoryId,
    repositoryPath,
    lastPulledAt,
    onAddTask,
}: TaskListHeaderProps) {
    const gitPull = useGitPull();

    const relativeTime = useMemo(
        () => (lastPulledAt ? formatRelativeTime(lastPulledAt) : null),
        [lastPulledAt],
    );

    return (
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
            <h2 className="text-lg font-semibold text-foreground">
                {projectName}
            </h2>
            <div className="flex items-center gap-2">
                {relativeTime && (
                    <span className="text-[11px] text-muted-foreground/60 tabular-nums">
                        Pulled {relativeTime}
                    </span>
                )}
                <Button
                    size="sm"
                    variant="ghost"
                    className="gap-1.5 text-muted-foreground"
                    onClick={() =>
                        gitPull.mutate({
                            path: repositoryPath,
                            repositoryId,
                        })
                    }
                    disabled={gitPull.isPending}
                    title={
                        gitPull.isError
                            ? `Pull failed: ${gitPull.error.message}`
                            : "Pull latest changes"
                    }
                >
                    {gitPull.isPending ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                        <ArrowDownToLine className="h-3.5 w-3.5" />
                    )}
                    Pull
                </Button>
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
        </div>
    );
}
