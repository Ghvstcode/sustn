import { Loader2 } from "lucide-react";
import { useEngineStatus } from "@core/api/useEngine";

interface TaskStatusBannerProps {
    taskId: string;
}

const phaseLabels: Record<string, string> = {
    Planning: "Planning implementation",
    Implementing: "Writing code",
    Reviewing: "Reviewing changes",
};

export function TaskStatusBanner({ taskId }: TaskStatusBannerProps) {
    const { data: status } = useEngineStatus();

    const isWorking = status?.currentTask?.taskId === taskId;
    const phase = status?.currentTask?.phase;

    if (!isWorking) return null;

    return (
        <div className="flex items-center gap-2.5 rounded-lg border border-blue-500/20 bg-blue-500/5 px-4 py-3">
            <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
            <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground">
                    Agent is working on this task
                </p>
                {phase && (
                    <p className="text-xs text-muted-foreground mt-0.5">
                        {phaseLabels[phase] ?? phase}
                    </p>
                )}
            </div>
            <div className="h-2 w-2 rounded-full bg-blue-500 animate-pulse" />
        </div>
    );
}
