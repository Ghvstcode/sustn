import { toast } from "sonner";
import { Check, Clock } from "lucide-react";

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
