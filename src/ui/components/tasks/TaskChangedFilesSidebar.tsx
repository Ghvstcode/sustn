import { FileCode2 } from "lucide-react";
import { ScrollArea } from "@ui/components/ui/scroll-area";
import type { DiffFileStat } from "@core/api/useEngine";

interface TaskChangedFilesSidebarProps {
    files: DiffFileStat[];
    activeFile: string | undefined;
    onFileSelect: (file: string) => void;
}

function fileName(path: string): string {
    return path.split("/").pop() ?? path;
}

function filePath(path: string): string {
    const parts = path.split("/");
    if (parts.length <= 1) return "";
    return parts.slice(0, -1).join("/") + "/";
}

export function TaskChangedFilesSidebar({
    files,
    activeFile,
    onFileSelect,
}: TaskChangedFilesSidebarProps) {
    const totalAdditions = files.reduce((sum, f) => sum + f.additions, 0);
    const totalDeletions = files.reduce((sum, f) => sum + f.deletions, 0);

    return (
        <div className="flex flex-col h-full border-l border-border">
            <div className="px-3 py-3 border-b border-border">
                <h3 className="text-xs font-medium text-foreground">
                    Changed Files
                </h3>
                <p className="text-[10px] text-muted-foreground mt-0.5">
                    {files.length} file{files.length !== 1 ? "s" : ""}{" "}
                    <span className="text-green-500">+{totalAdditions}</span>{" "}
                    <span className="text-red-500">-{totalDeletions}</span>
                </p>
            </div>

            <ScrollArea className="flex-1">
                <div className="py-1">
                    {files.map((file) => (
                        <button
                            key={file.file}
                            type="button"
                            onClick={() => onFileSelect(file.file)}
                            className={`w-full text-left px-3 py-1.5 flex items-center gap-2 hover:bg-muted/50 transition-colors ${
                                activeFile === file.file ? "bg-muted" : ""
                            }`}
                        >
                            <FileCode2 className="h-3 w-3 text-muted-foreground shrink-0" />
                            <div className="flex-1 min-w-0">
                                <p className="text-xs font-medium text-foreground truncate">
                                    {fileName(file.file)}
                                </p>
                                {filePath(file.file) && (
                                    <p className="text-[10px] text-muted-foreground/60 truncate">
                                        {filePath(file.file)}
                                    </p>
                                )}
                            </div>
                            <div className="flex items-center gap-1 shrink-0 text-[10px] font-mono">
                                {file.additions > 0 && (
                                    <span className="text-green-500">
                                        +{file.additions}
                                    </span>
                                )}
                                {file.deletions > 0 && (
                                    <span className="text-red-500">
                                        -{file.deletions}
                                    </span>
                                )}
                            </div>
                        </button>
                    ))}
                </div>
            </ScrollArea>
        </div>
    );
}
