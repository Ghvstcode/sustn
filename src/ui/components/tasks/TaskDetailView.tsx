import { useState, useCallback } from "react";
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
import { Separator } from "@ui/components/ui/separator";
import type { TaskState } from "@core/types/task";
import { TaskDetailHeader } from "./TaskDetailHeader";
import { TaskOverview } from "./TaskOverview";
import { TaskActions } from "./TaskActions";
import { TaskChatTimeline } from "./TaskChatTimeline";
import { TaskDiffViewer } from "./TaskDiffViewer";
import { TaskChangedFilesSidebar } from "./TaskChangedFilesSidebar";
import { TaskFilesInvolved } from "./TaskFilesInvolved";
import { TaskStatusBanner } from "./TaskStatusBanner";

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

    const [activeFile, setActiveFile] = useState<string | undefined>();

    // Listen for real-time task lifecycle events from the Rust backend
    useTaskEventListeners(taskId, task?.repositoryId);

    // Look up repository for repo path
    const repository = repositories?.find((r) => r.id === task?.repositoryId);
    const repoPath = repository?.path;

    // Diff data (only fetch when we have branch info)
    const hasBranch = !!task?.branchName && !!task?.baseBranch;
    const showDiff = task?.state === "review" || task?.state === "done";

    const { data: diffStat } = useDiffStat(
        showDiff && hasBranch ? repoPath : undefined,
        showDiff && hasBranch ? task?.baseBranch : undefined,
        showDiff && hasBranch ? task?.branchName : undefined,
    );
    const { data: diffText } = useDiff(
        showDiff && hasBranch ? repoPath : undefined,
        showDiff && hasBranch ? task?.baseBranch : undefined,
        showDiff && hasBranch ? task?.branchName : undefined,
    );

    const isReadOnly = task?.state === "done" || task?.state === "dismissed";

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
        console.log(
            "[TaskDetailView] handleStartWork — taskId:",
            taskId,
            "repoPath:",
            repoPath,
        );
        // Move to in_progress state
        updateTask.mutate({
            id: taskId,
            state: "in_progress" as TaskState,
            startedAt: new Date().toISOString(),
        });
        // Start the agent work
        console.log(
            "[TaskDetailView] invoking startTask mutation — title:",
            task.title,
            "files:",
            task.filesInvolved,
        );
        startTask.mutate({
            taskId: task.id,
            repositoryId: task.repositoryId,
            repoPath,
            taskTitle: task.title,
            taskDescription: task.description ?? "",
            filesInvolved: task.filesInvolved ?? [],
        });
    }

    function handleCreatePr() {
        if (!repoPath || !task?.branchName) return;
        pushBranch.mutate(
            { repoPath, branchName: task.branchName },
            {
                onSuccess: (result) => {
                    if (result.success) {
                        // Construct PR URL — user can update it later
                        // For now just record that branch was pushed
                        sendMessage.mutate({
                            taskId,
                            role: "system",
                            content: `Branch ${task.branchName} pushed to remote.`,
                        });
                    }
                },
            },
        );
    }

    // Determine if we should show the sidebar
    const showSidebar = showDiff && diffStat && diffStat.length > 0;

    return (
        <div className="flex h-full flex-col">
            <TaskDetailHeader
                task={task}
                repoPath={repoPath}
                onBack={() => setSelectedTask(undefined)}
                onUpdateTitle={handleUpdateTitle}
                onDelete={handleDelete}
            />

            <div className="flex flex-1 overflow-hidden">
                {/* Main content area */}
                <div className="flex-1 overflow-y-auto">
                    <div className="mx-auto w-full max-w-3xl space-y-6 px-6 py-5">
                        {/* In-progress status banner */}
                        {task.state === "in_progress" && (
                            <TaskStatusBanner taskId={taskId} />
                        )}

                        {/* Description */}
                        <TaskOverview task={task} />

                        {/* Files involved (pending/in_progress) */}
                        {(task.state === "pending" ||
                            task.state === "in_progress") &&
                            task.filesInvolved &&
                            task.filesInvolved.length > 0 && (
                                <>
                                    <Separator />
                                    <TaskFilesInvolved
                                        files={task.filesInvolved}
                                    />
                                </>
                            )}

                        {/* Actions */}
                        <Separator />
                        <TaskActions
                            task={task}
                            isStarting={startTask.isPending}
                            isPushing={pushBranch.isPending}
                            onUpdateState={handleUpdateState}
                            onStartWork={repoPath ? handleStartWork : undefined}
                            onCreatePr={
                                task.branchName ? handleCreatePr : undefined
                            }
                            onRequestChanges={
                                task.state === "review"
                                    ? handleRequestChanges
                                    : undefined
                            }
                        />

                        {/* Diff viewer (review/done with branch) */}
                        {showDiff && diffText && (
                            <>
                                <Separator />
                                <TaskDiffViewer
                                    diffText={diffText}
                                    activeFile={activeFile}
                                />
                            </>
                        )}

                        {/* Chat + Activity Timeline */}
                        <Separator />
                        <TaskChatTimeline
                            taskId={taskId}
                            readOnly={isReadOnly}
                        />
                    </div>
                </div>

                {/* Changed files sidebar (review/done) */}
                {showSidebar && (
                    <div className="w-[240px] shrink-0">
                        <TaskChangedFilesSidebar
                            files={diffStat}
                            activeFile={activeFile}
                            onFileSelect={setActiveFile}
                        />
                    </div>
                )}
            </div>
        </div>
    );
}
