import { Button } from "@ui/components/ui/button";
import { Play, GitPullRequest, CheckCircle2, XCircle } from "lucide-react";
import type { TaskState } from "@core/types/task";

interface TaskActionsProps {
    state: TaskState;
    onUpdateState: (state: TaskState) => void;
}

export function TaskActions({ state, onUpdateState }: TaskActionsProps) {
    return (
        <div>
            <h3 className="text-sm font-medium text-foreground mb-2">
                Actions
            </h3>
            <div className="flex flex-wrap gap-2">
                {state === "pending" && (
                    <Button
                        size="sm"
                        className="gap-1.5"
                        onClick={() => onUpdateState("in_progress")}
                    >
                        <Play className="h-3.5 w-3.5" />
                        Start
                    </Button>
                )}

                {state === "in_progress" && (
                    <>
                        <Button
                            size="sm"
                            className="gap-1.5"
                            onClick={() => onUpdateState("review")}
                        >
                            <GitPullRequest className="h-3.5 w-3.5" />
                            Request Review
                        </Button>
                        <Button
                            size="sm"
                            variant="outline"
                            className="gap-1.5"
                            onClick={() => onUpdateState("done")}
                        >
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            Mark Done
                        </Button>
                    </>
                )}

                {state === "review" && (
                    <Button
                        size="sm"
                        className="gap-1.5"
                        onClick={() => onUpdateState("done")}
                    >
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        Mark Done
                    </Button>
                )}

                {state !== "done" && state !== "dismissed" && (
                    <Button
                        size="sm"
                        variant="ghost"
                        className="gap-1.5 text-muted-foreground"
                        onClick={() => onUpdateState("dismissed")}
                    >
                        <XCircle className="h-3.5 w-3.5" />
                        Dismiss
                    </Button>
                )}
            </div>
        </div>
    );
}
