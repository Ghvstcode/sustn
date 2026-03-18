import { toast } from "sonner";
import { invoke } from "@tauri-apps/api/core";
import { Check, Clock, AlertTriangle, Terminal } from "lucide-react";

export function savedToast() {
    toast.custom(
        () => (
            <div className="flex items-center gap-1.5 rounded-full bg-foreground pl-2 pr-2.5 py-1 shadow-md animate-fade-in-up">
                <div className="flex h-3.5 w-3.5 items-center justify-center rounded-full bg-emerald-500">
                    <Check className="h-2 w-2 text-white" strokeWidth={3} />
                </div>
                <span className="text-[12px] font-medium text-background">
                    Saved
                </span>
            </div>
        ),
        { id: "settings-saved", duration: 1500 },
    );
}

export function queuedToast() {
    toast.custom(
        () => (
            <div className="flex items-center gap-1.5 rounded-full bg-foreground pl-2 pr-2.5 py-1 shadow-md animate-fade-in-up">
                <div className="flex h-3.5 w-3.5 items-center justify-center rounded-full bg-violet-500">
                    <Clock className="h-2 w-2 text-white" strokeWidth={3} />
                </div>
                <span className="text-[12px] font-medium text-background">
                    Queued up next
                </span>
            </div>
        ),
        { id: "task-queued", duration: 2500 },
    );
}

export function environmentIssueToast(
    error: string,
    fixCommand?: string,
    fixLabel?: string,
) {
    toast.custom(
        (id) => (
            <div className="flex flex-col gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 shadow-lg max-w-sm">
                <div className="flex items-start gap-2">
                    <AlertTriangle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
                    <span className="text-[13px] font-medium text-destructive leading-snug">
                        {error}
                    </span>
                </div>
                {fixCommand && (
                    <button
                        onClick={() => {
                            void invoke("run_terminal_command", {
                                command: fixCommand,
                            });
                            toast.dismiss(id);
                        }}
                        className="flex items-center gap-1.5 self-start rounded-md bg-foreground px-2.5 py-1 text-[12px] font-medium text-background transition-opacity hover:opacity-80"
                    >
                        <Terminal className="h-3 w-3" />
                        {fixLabel ?? "Fix in Terminal"}
                    </button>
                )}
            </div>
        ),
        { id: "environment-issue", duration: Infinity },
    );
}
