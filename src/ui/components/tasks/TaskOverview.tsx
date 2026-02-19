import { Badge } from "@ui/components/ui/badge";
import { Sparkles } from "lucide-react";
import type { Task } from "@core/types/task";

interface TaskOverviewProps {
    task: Task;
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

export function TaskOverview({ task }: TaskOverviewProps) {
    return (
        <div className="space-y-4">
            <div className="flex items-center gap-2">
                <Badge variant="secondary">
                    {categoryLabels[task.category]}
                </Badge>
            </div>

            {task.description && (
                <p className="text-sm text-muted-foreground leading-relaxed">
                    {task.description}
                </p>
            )}

            {/* AI Overview placeholder */}
            <div className="rounded-lg border border-border bg-muted/30 p-4">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Sparkles className="h-4 w-4" />
                    <span className="font-medium">AI Overview</span>
                </div>
                <p className="mt-2 text-xs text-muted-foreground/70">
                    AI-generated analysis will appear here once the agent has
                    processed this task.
                </p>
            </div>
        </div>
    );
}
