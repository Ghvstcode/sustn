import { FileCode2 } from "lucide-react";

interface TaskFilesInvolvedProps {
    files: string[];
}

export function TaskFilesInvolved({ files }: TaskFilesInvolvedProps) {
    if (files.length === 0) return null;

    return (
        <div>
            <h3 className="text-sm font-medium text-foreground mb-2">
                Files Involved
            </h3>
            <div className="space-y-1">
                {files.map((file) => (
                    <div
                        key={file}
                        className="flex items-center gap-2 rounded px-2 py-1 text-xs font-mono text-muted-foreground hover:bg-muted/50 transition-colors"
                    >
                        <FileCode2 className="h-3 w-3 shrink-0" />
                        <span className="truncate">{file}</span>
                    </div>
                ))}
            </div>
        </div>
    );
}
