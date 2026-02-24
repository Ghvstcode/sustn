import { toast } from "sonner";
import { Check, Clock, Undo2 } from "lucide-react";

/**
 * Shows a toast with an "Undo" button. If the user clicks Undo within the
 * duration window, `onUndo` fires and the toast is dismissed. Otherwise the
 * toast disappears and the change sticks.
 */
export function undoToast(message: string, onUndo: () => void) {
    const id = "settings-undo";
    toast.custom(
        () => (
            <div className="flex items-center gap-2 rounded-full bg-foreground pl-2.5 pr-1 py-1 shadow-md animate-fade-in-up">
                <span className="text-[12px] font-medium text-background">
                    {message}
                </span>
                <button
                    type="button"
                    onClick={() => {
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
        { id, duration: 5000 },
    );
}

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
