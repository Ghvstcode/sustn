import { toast } from "sonner";
import { Check, Clock, Undo2 } from "lucide-react";

/**
 * When an undo toast is visible we suppress the normal "Saved" toast so the
 * two don't fight for the user's attention. The flag is set when `undoToast`
 * fires and cleared after the undo window expires or the user clicks Undo.
 */
let undoActive = false;
let undoTimer: ReturnType<typeof setTimeout> | undefined;

const UNDO_DURATION = 5000;

function markUndoActive() {
    undoActive = true;
    clearTimeout(undoTimer);
    undoTimer = setTimeout(() => {
        undoActive = false;
    }, UNDO_DURATION + 500); // small buffer past toast duration
}

/**
 * Shows a toast with an "Undo" button. If the user clicks Undo within the
 * duration window, `onUndo` fires and the toast is dismissed. Otherwise the
 * toast disappears and the change sticks.
 *
 * While the undo toast is visible, `savedToast()` calls are suppressed so the
 * two toasts don't overlap or replace each other.
 */
export function undoToast(message: string, onUndo: () => void) {
    const id = "settings-undo";
    markUndoActive();
    toast.custom(
        () => (
            <div className="flex items-center gap-2 rounded-full bg-foreground pl-2.5 pr-1 py-1 shadow-md animate-fade-in-up">
                <span className="text-[12px] font-medium text-background">
                    {message}
                </span>
                <button
                    type="button"
                    onClick={() => {
                        markUndoActive(); // suppress savedToast from the undo mutation too
                        onUndo();
                        toast.dismiss(id);
                    }}
                    className="flex items-center gap-1 rounded-full bg-background/15 px-2 py-0.5 text-[11px] font-medium text-background hover:bg-background/25 transition-colors"
                >
                    <Undo2 className="h-2.5 w-2.5" />
                    Undo
                </button>
            </div>
        ),
        { id, duration: UNDO_DURATION },
    );
}

export function savedToast() {
    // Don't show "Saved" while an undo toast is active — the undo toast
    // already communicates that the change was applied.
    if (undoActive) return;

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
