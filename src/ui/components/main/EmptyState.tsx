import { FolderOpen } from "lucide-react";

export function EmptyState() {
    return (
        <div className="flex h-full flex-col items-center justify-center text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-border">
                <FolderOpen className="h-6 w-6 text-muted-foreground" />
            </div>
            <h2 className="mt-4 text-lg font-semibold text-foreground">
                Select a project
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
                Choose a project from the sidebar to see its tasks.
            </p>
        </div>
    );
}
