import { useState, useCallback, useRef, useEffect } from "react";
import {
    ArrowUp,
    Play,
    ExternalLink,
    CheckCircle2,
    MessageSquarePlus,
    RotateCcw,
    XCircle,
    X,
    Loader2,
    AlertTriangle,
    LayoutDashboard,
} from "lucide-react";
import {
    useTask,
    useUpdateTask,
    useDeleteTask,
    useSendMessage,
} from "@core/api/useTasks";
import { useRepositories } from "@core/api/useRepositories";
import {
    useStartTask,
    usePushBranch,
    useDiffStat,
    useDiff,
    useTaskEventListeners,
} from "@core/api/useEngine";
import { useAppStore } from "@core/store/app-store";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { TaskState } from "@core/types/task";
import { Button } from "@ui/components/ui/button";
import { DropdownMenuItem } from "@ui/components/ui/dropdown-menu";
import { TaskDetailHeader } from "./TaskDetailHeader";
import { TaskOverview } from "./TaskOverview";
import { TaskChatTimeline } from "./TaskChatTimeline";
import { TaskDiffViewer } from "./TaskDiffViewer";
import { TaskChangedFilesSidebar } from "./TaskChangedFilesSidebar";
import { TaskFilesInvolved } from "./TaskFilesInvolved";
import { TaskStatusBanner } from "./TaskStatusBanner";
import { FileContentViewer } from "./FileContentViewer";

// ── Constants ───────────────────────────────────────────────

const btnClass =
    "group h-7 gap-1.5 text-xs whitespace-nowrap transition-all duration-200 hover:-translate-y-px hover:shadow-sm active:translate-y-0 active:shadow-none";

const SIDEBAR_MIN = 220;
const SIDEBAR_MAX = 500;
const SIDEBAR_DEFAULT = 280;

// ── Types ───────────────────────────────────────────────────

type TabKind = "diff" | "file";

interface FileTab {
    path: string;
    kind: TabKind;
}

// ── Helpers ─────────────────────────────────────────────────

function getFileName(path: string): string {
    return path.split("/").pop() ?? path;
}

// ── Chat input ─────────────────────────────────────────────

function ChatInput({
    taskId,
    placeholder,
}: {
    taskId: string;
    placeholder?: string;
}) {
    const [draft, setDraft] = useState("");
    const sendMessage = useSendMessage();
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    function handleSend() {
        const trimmed = draft.trim();
        if (!trimmed) return;
        sendMessage.mutate(
            { taskId, role: "user", content: trimmed },
            {
                onSuccess: () => {
                    setDraft("");
                    if (textareaRef.current) {
                        textareaRef.current.style.height = "auto";
                    }
                },
            },
        );
    }

    function handleKeyDown(e: React.KeyboardEvent) {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    }

    function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
        setDraft(e.target.value);
        const el = e.target;
        el.style.height = "auto";
        el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
    }

    const hasContent = draft.trim().length > 0;

    return (
        <div className="overflow-hidden rounded-xl border border-border bg-muted/30 focus-within:ring-1 focus-within:ring-ring focus-within:border-ring focus-within:bg-background transition-all">
            <textarea
                ref={textareaRef}
                value={draft}
                onChange={handleChange}
                onKeyDown={handleKeyDown}
                placeholder={placeholder ?? "Add context for the agent..."}
                rows={1}
                className="w-full resize-none bg-transparent px-4 pt-3 pb-1.5 text-sm leading-relaxed placeholder:text-muted-foreground/40 focus:outline-none"
                style={{ minHeight: "40px", maxHeight: "120px" }}
            />
            <div className="flex items-center justify-between px-3 pb-2.5">
                <span className="text-[11px] text-muted-foreground/25 select-none">
                    ↵ to send
                </span>
                <button
                    type="button"
                    onClick={handleSend}
                    disabled={!hasContent || sendMessage.isPending}
                    className={`flex h-6 w-6 items-center justify-center rounded-lg transition-all duration-200 ${
                        hasContent
                            ? "bg-foreground text-background shadow-sm hover:bg-foreground/90"
                            : "bg-transparent text-muted-foreground/20"
                    }`}
                >
                    <ArrowUp className="h-3.5 w-3.5" />
                </button>
            </div>
        </div>
    );
}

// ── Main component ─────────────────────────────────────────

interface TaskDetailViewProps {
    taskId: string;
}

export function TaskDetailView({ taskId }: TaskDetailViewProps) {
    const { data: task, isLoading } = useTask(taskId);
    const { data: repositories } = useRepositories();
    const updateTask = useUpdateTask();
    const deleteTask = useDeleteTask();
    const startTask = useStartTask();
    const pushBranch = usePushBranch();
    const sendMessage = useSendMessage();
    const setSelectedTask = useAppStore((s) => s.setSelectedTask);

    // ── Tab state (typed) ──
    const [openTabs, setOpenTabs] = useState<FileTab[]>([]);
    const [activeTab, setActiveTab] = useState("overview");

    // ── Sidebar resize ──
    const [sidebarWidth, setSidebarWidth] = useState(SIDEBAR_DEFAULT);
    const isDraggingSidebar = useRef(false);
    const dragStartRef = useRef({ x: 0, width: 0 });

    // Reset when switching tasks
    useEffect(() => {
        setOpenTabs([]);
        setActiveTab("overview");
    }, [taskId]);

    // Listen for real-time task lifecycle events from the Rust backend
    useTaskEventListeners(taskId, task?.repositoryId);

    // Look up repository for repo path
    const repository = repositories?.find((r) => r.id === task?.repositoryId);
    const repoPath = repository?.path;
    const defaultBranch = repository?.defaultBranch ?? "main";

    // Diff data — fall back to repo defaultBranch if task.baseBranch is missing
    const baseBranch = task?.baseBranch ?? defaultBranch;
    const hasBranch = !!task?.branchName && !!baseBranch;
    const showDiff = task?.state === "review" || task?.state === "done";

    const { data: diffStat } = useDiffStat(
        showDiff && hasBranch ? repoPath : undefined,
        showDiff && hasBranch ? baseBranch : undefined,
        showDiff && hasBranch ? task?.branchName : undefined,
    );
    const { data: diffText } = useDiff(
        showDiff && hasBranch ? repoPath : undefined,
        showDiff && hasBranch ? baseBranch : undefined,
        showDiff && hasBranch ? task?.branchName : undefined,
    );

    const isReadOnly = task?.state === "done" || task?.state === "dismissed";
    const hasChanges = !!(showDiff && diffStat && diffStat.length > 0);
    const showSidebar = !!repoPath;

    // Look up the active tab's kind
    const activeFileTab = openTabs.find((t) => t.path === activeTab);
    const isShowingDiff =
        activeTab !== "overview" && activeFileTab?.kind === "diff";
    const isShowingFile =
        activeTab !== "overview" && activeFileTab?.kind === "file";

    // ── Sidebar resize handlers ──

    const handleResizeStart = useCallback(
        (e: React.MouseEvent) => {
            e.preventDefault();
            isDraggingSidebar.current = true;
            dragStartRef.current = { x: e.clientX, width: sidebarWidth };
            document.body.style.cursor = "col-resize";
            document.body.style.userSelect = "none";
        },
        [sidebarWidth],
    );

    useEffect(() => {
        function onMouseMove(e: MouseEvent) {
            if (!isDraggingSidebar.current) return;
            const delta = dragStartRef.current.x - e.clientX;
            setSidebarWidth(
                Math.min(
                    SIDEBAR_MAX,
                    Math.max(SIDEBAR_MIN, dragStartRef.current.width + delta),
                ),
            );
        }
        function onMouseUp() {
            if (!isDraggingSidebar.current) return;
            isDraggingSidebar.current = false;
            document.body.style.cursor = "";
            document.body.style.userSelect = "";
        }
        window.addEventListener("mousemove", onMouseMove);
        window.addEventListener("mouseup", onMouseUp);
        return () => {
            window.removeEventListener("mousemove", onMouseMove);
            window.removeEventListener("mouseup", onMouseUp);
        };
    }, []);

    // ── Callbacks ──

    const handleRequestChanges = useCallback(() => {
        updateTask.mutate({ id: taskId, state: "pending" as TaskState });
        sendMessage.mutate({
            taskId,
            role: "system",
            content: "User requested changes — task moved back to pending.",
        });
    }, [taskId, updateTask, sendMessage]);

    if (isLoading || !task) {
        return (
            <div className="flex h-full items-center justify-center">
                <p className="text-sm text-muted-foreground">Loading...</p>
            </div>
        );
    }

    function handleUpdateState(state: TaskState) {
        updateTask.mutate({ id: taskId, state });
    }

    function handleUpdateTitle(title: string) {
        updateTask.mutate({ id: taskId, title });
    }

    function handleDelete() {
        deleteTask.mutate(
            { id: taskId, repositoryId: task!.repositoryId },
            { onSuccess: () => setSelectedTask(undefined) },
        );
    }

    function handleStartWork() {
        if (!repoPath || !task) return;
        updateTask.mutate({
            id: taskId,
            state: "in_progress" as TaskState,
            startedAt: new Date().toISOString(),
        });
        startTask.mutate({
            taskId: task.id,
            repositoryId: task.repositoryId,
            repoPath,
            taskTitle: task.title,
            taskDescription: task.description ?? "",
            filesInvolved: task.filesInvolved ?? [],
        });
    }

    function handleApproveAndCreatePr() {
        if (!task) return;
        if (task.branchName && !task.prUrl && repoPath) {
            pushBranch.mutate(
                { repoPath, branchName: task.branchName },
                {
                    onSuccess: (result) => {
                        if (result.success) {
                            sendMessage.mutate({
                                taskId,
                                role: "system",
                                content: `Branch ${task.branchName} pushed to remote. Task approved.`,
                            });
                        }
                        handleUpdateState("done");
                    },
                },
            );
        } else {
            handleUpdateState("done");
        }
    }

    // ── Tab handlers ──

    function openTab(path: string, kind: TabKind) {
        setOpenTabs((prev) => {
            // If a tab for this path already exists (any kind), just activate it
            if (prev.find((t) => t.path === path)) return prev;
            return [...prev, { path, kind }];
        });
        setActiveTab(path);
    }

    function handleDiffFileSelect(file: string) {
        openTab(file, "diff");
    }

    function handleBrowseFileSelect(file: string) {
        openTab(file, "file");
    }

    function handleCloseTab(path: string) {
        setOpenTabs((prev) => prev.filter((t) => t.path !== path));
        if (activeTab === path) setActiveTab("overview");
    }

    // ── Build primary action for header ──

    let primaryAction: React.ReactNode = null;
    const state = task.state;

    if (state === "pending" && repoPath) {
        primaryAction = (
            <Button
                size="sm"
                className={btnClass}
                onClick={handleStartWork}
                disabled={startTask.isPending}
            >
                {startTask.isPending ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                    <Play className="h-3.5 w-3.5 transition-transform duration-200 group-hover:scale-110" />
                )}
                Start Work
            </Button>
        );
    } else if (state === "done" && task.prUrl) {
        primaryAction = (
            <Button
                size="sm"
                variant="outline"
                className={btnClass}
                onClick={() => void openUrl(task.prUrl!)}
            >
                <ExternalLink className="h-3.5 w-3.5" />
                View PR
            </Button>
        );
    } else if (state === "failed") {
        primaryAction = (
            <Button
                size="sm"
                className={btnClass}
                onClick={() => handleUpdateState("pending")}
            >
                <RotateCcw className="h-3.5 w-3.5" />
                Retry
            </Button>
        );
    }

    // ── Build overflow items for header ⋮ menu ──

    let overflowItems: React.ReactNode = null;

    if (state === "review") {
        overflowItems = (
            <DropdownMenuItem onClick={() => handleUpdateState("dismissed")}>
                <XCircle className="h-4 w-4 mr-2" />
                Dismiss
            </DropdownMenuItem>
        );
    } else if (state === "pending") {
        overflowItems = (
            <DropdownMenuItem onClick={() => handleUpdateState("dismissed")}>
                <XCircle className="h-4 w-4 mr-2" />
                Dismiss
            </DropdownMenuItem>
        );
    } else if (state === "done") {
        overflowItems = (
            <DropdownMenuItem onClick={() => handleUpdateState("pending")}>
                <RotateCcw className="h-4 w-4 mr-2" />
                Reopen
            </DropdownMenuItem>
        );
    }

    // ── Build sidebar actions (review state) ──

    let sidebarActions: React.ReactNode = null;

    if (state === "review") {
        sidebarActions = (
            <>
                <Button
                    variant="outline"
                    size="sm"
                    className={btnClass}
                    onClick={handleRequestChanges}
                >
                    <MessageSquarePlus className="h-3.5 w-3.5" />
                    Request Changes
                </Button>
                {task.branchName && !task.prUrl ? (
                    <Button
                        size="sm"
                        className={btnClass}
                        onClick={handleApproveAndCreatePr}
                        disabled={pushBranch.isPending}
                    >
                        {pushBranch.isPending ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                            <CheckCircle2 className="h-3.5 w-3.5" />
                        )}
                        Approve & Create PR
                    </Button>
                ) : (
                    <>
                        <Button
                            size="sm"
                            className={btnClass}
                            onClick={() => handleUpdateState("done")}
                        >
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            Approve
                        </Button>
                        {task.prUrl && (
                            <Button
                                size="sm"
                                variant="outline"
                                className={btnClass}
                                onClick={() => void openUrl(task.prUrl!)}
                            >
                                <ExternalLink className="h-3.5 w-3.5" />
                                View PR
                            </Button>
                        )}
                    </>
                )}
            </>
        );
    }

    // ── Determine content to show ──

    const showTabBar = openTabs.length > 0 || hasChanges;

    return (
        <div className="flex h-full">
            {/* ── Left: content column ── */}
            <div className="flex flex-1 flex-col overflow-hidden">
                <TaskDetailHeader
                    task={task}
                    repoPath={repoPath}
                    primaryAction={primaryAction}
                    overflowItems={overflowItems}
                    onBack={() => setSelectedTask(undefined)}
                    onUpdateTitle={handleUpdateTitle}
                    onDelete={handleDelete}
                />

                {/* Tab bar */}
                {showTabBar && (
                    <div className="flex items-center h-9 border-b border-border shrink-0 px-1">
                        <button
                            type="button"
                            onClick={() => setActiveTab("overview")}
                            className={`relative flex items-center gap-1.5 px-3 h-full text-xs shrink-0 transition-colors ${
                                activeTab === "overview"
                                    ? "text-foreground font-medium"
                                    : "text-muted-foreground hover:text-foreground"
                            }`}
                        >
                            <LayoutDashboard className="h-3 w-3" />
                            Overview
                            {activeTab === "overview" && (
                                <div className="absolute bottom-0 left-2 right-2 h-0.5 bg-foreground rounded-full" />
                            )}
                        </button>

                        {openTabs.map((tab) => {
                            const isActive = activeTab === tab.path;
                            return (
                                <div
                                    key={tab.path}
                                    className={`group relative flex items-center h-full shrink-0 ${
                                        isActive
                                            ? "text-foreground"
                                            : "text-muted-foreground hover:text-foreground"
                                    }`}
                                >
                                    <button
                                        type="button"
                                        onClick={() => setActiveTab(tab.path)}
                                        className="flex items-center gap-1.5 px-3 h-full text-xs"
                                    >
                                        {tab.kind === "diff" && (
                                            <span className="h-1.5 w-1.5 rounded-full bg-amber-500/60 shrink-0" />
                                        )}
                                        <span
                                            className={`truncate max-w-[140px] font-mono ${isActive ? "font-medium" : ""}`}
                                        >
                                            {getFileName(tab.path)}
                                        </span>
                                    </button>
                                    <button
                                        type="button"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            handleCloseTab(tab.path);
                                        }}
                                        className={`mr-1.5 rounded p-0.5 transition-opacity hover:bg-muted ${
                                            isActive
                                                ? "opacity-50 hover:opacity-100"
                                                : "opacity-0 group-hover:opacity-50 hover:!opacity-100"
                                        }`}
                                    >
                                        <X className="h-3 w-3" />
                                    </button>
                                    {isActive && (
                                        <div className="absolute bottom-0 left-2 right-2 h-0.5 bg-foreground rounded-full" />
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}

                {/* Scrollable content */}
                <div className="flex-1 overflow-y-auto">
                    {isShowingDiff ? (
                        diffText ? (
                            <div className="px-6 pt-4 pb-8">
                                <TaskDiffViewer
                                    diffText={diffText}
                                    singleFile={activeTab}
                                />
                            </div>
                        ) : (
                            <div className="flex h-32 items-center justify-center">
                                <p className="text-xs text-muted-foreground/40">
                                    Loading changes...
                                </p>
                            </div>
                        )
                    ) : isShowingFile && repoPath ? (
                        <div className="px-6 pt-4 pb-8">
                            <FileContentViewer
                                repoPath={repoPath}
                                relativePath={activeTab}
                            />
                        </div>
                    ) : (
                        <div className="mx-auto w-full max-w-2xl px-6 pt-6 pb-8">
                            {task.state === "in_progress" && (
                                <div className="mb-5">
                                    <TaskStatusBanner taskId={taskId} />
                                </div>
                            )}

                            {task.state === "failed" && task.lastError && (
                                <div className="mb-5 flex items-start gap-2 rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2.5">
                                    <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-destructive mt-0.5" />
                                    <p className="text-xs text-destructive leading-relaxed">
                                        {task.lastError}
                                    </p>
                                </div>
                            )}

                            <TaskOverview task={task} />

                            {(task.state === "pending" ||
                                task.state === "in_progress") &&
                                task.filesInvolved &&
                                task.filesInvolved.length > 0 && (
                                    <div className="mt-3">
                                        <TaskFilesInvolved
                                            files={task.filesInvolved}
                                        />
                                    </div>
                                )}

                            <div className="mt-8 border-t border-border/50 pt-5">
                                <p className="mb-3 text-[11px] font-medium uppercase tracking-wider text-muted-foreground/40">
                                    Activity
                                </p>
                                <TaskChatTimeline taskId={taskId} />
                            </div>
                        </div>
                    )}
                </div>

                {/* Chat input */}
                {!isReadOnly && (
                    <div className="shrink-0 bg-background px-6 py-3">
                        <div
                            className={
                                isShowingDiff || isShowingFile
                                    ? "w-full"
                                    : "mx-auto w-full max-w-2xl"
                            }
                        >
                            <ChatInput
                                taskId={taskId}
                                placeholder={
                                    isShowingDiff
                                        ? "Leave feedback on the changes..."
                                        : "Add context for the agent..."
                                }
                            />
                        </div>
                    </div>
                )}
            </div>

            {/* ── Resize handle (true full height) ── */}
            {showSidebar && (
                <div
                    onMouseDown={handleResizeStart}
                    className="relative z-10 w-0 cursor-col-resize before:absolute before:-left-1 before:top-0 before:h-full before:w-2 before:content-[''] hover:before:bg-ring/20 active:before:bg-ring/30"
                />
            )}

            {/* ── Right: sidebar (true full height) ── */}
            {showSidebar && (
                <div
                    className="shrink-0 h-full"
                    style={{ width: sidebarWidth }}
                >
                    <TaskChangedFilesSidebar
                        repoPath={repoPath}
                        files={diffStat ?? []}
                        activeFile={
                            activeTab !== "overview" ? activeTab : undefined
                        }
                        onDiffFileSelect={handleDiffFileSelect}
                        onBrowseFileSelect={handleBrowseFileSelect}
                        actions={sidebarActions}
                        hasChanges={hasChanges}
                    />
                </div>
            )}
        </div>
    );
}
