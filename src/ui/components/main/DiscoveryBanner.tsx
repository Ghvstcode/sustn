import { useEffect, useState } from "react";
import { Loader2, X, Check } from "lucide-react";

interface DiscoveryBannerProps {
    isScanning: boolean;
    tasksFound: number;
}

export function DiscoveryBanner({
    isScanning,
    tasksFound,
}: DiscoveryBannerProps) {
    const [dismissed, setDismissed] = useState(false);
    const [showComplete, setShowComplete] = useState(false);

    // When scan completes, show "complete" message briefly
    useEffect(() => {
        if (!isScanning && tasksFound > 0 && !dismissed) {
            setShowComplete(true);
            const timer = setTimeout(() => {
                setShowComplete(false);
                setDismissed(true);
            }, 4000);
            return () => clearTimeout(timer);
        }
    }, [isScanning, tasksFound, dismissed]);

    // Reset dismissed state when a new scan starts
    useEffect(() => {
        if (isScanning) {
            setDismissed(false);
            setShowComplete(false);
        }
    }, [isScanning]);

    if (!isScanning && !showComplete) return null;
    if (dismissed) return null;

    return (
        <div className="flex items-center gap-3 border-b border-border bg-muted/30 px-6 py-2.5 animate-fade-in-up">
            {isScanning ? (
                <>
                    <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-foreground/50" />
                    <span className="flex-1 text-xs text-foreground/70">
                        Discovering tasks...
                        {tasksFound > 0 && (
                            <span className="ml-1.5 font-medium text-foreground">
                                {tasksFound} new{" "}
                                {tasksFound === 1 ? "task" : "tasks"} found so
                                far
                            </span>
                        )}
                    </span>
                </>
            ) : (
                <>
                    <Check className="h-3.5 w-3.5 shrink-0 text-foreground/50" />
                    <span className="flex-1 text-xs text-foreground/70">
                        Scan complete
                        {tasksFound > 0 && (
                            <span className="ml-1 font-medium text-foreground">
                                — {tasksFound} new{" "}
                                {tasksFound === 1 ? "task" : "tasks"} found
                            </span>
                        )}
                    </span>
                </>
            )}
            <button
                type="button"
                onClick={() => setDismissed(true)}
                className="shrink-0 rounded p-0.5 text-muted-foreground/50 hover:text-muted-foreground transition-colors"
            >
                <X className="h-3 w-3" />
            </button>
        </div>
    );
}
