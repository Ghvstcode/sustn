import { useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
    getAgentConfig,
    updateAgentConfig,
    getBudgetConfig,
    updateBudgetConfig,
} from "@core/db/agent-config";
import {
    createScannedTask,
    getDeduplicationContext,
    recoverStaleTasks,
    updateTask as dbUpdateTask,
} from "@core/db/tasks";
import type {
    BudgetConfig,
    BudgetStatus,
    EngineStatus,
    ScanResult,
    ScheduleMode,
    WorkResult,
} from "@core/types/agent";
import { metrics } from "@core/services/metrics";

// ── Budget ──────────────────────────────────────────────────

export function useBudgetStatus() {
    return useQuery({
        queryKey: ["budget-status"],
        queryFn: () => invoke<BudgetStatus>("engine_get_budget"),
        refetchInterval: 60_000, // Refresh every minute
    });
}

export function useBudgetConfig() {
    return useQuery({
        queryKey: ["budget-config"],
        queryFn: getBudgetConfig,
    });
}

export function useUpdateBudgetConfig() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (fields: Partial<BudgetConfig>) =>
            updateBudgetConfig(fields),
        onSuccess: () => {
            metrics.track("settings_changed", { setting: "budget_config" });
            void queryClient.invalidateQueries({
                queryKey: ["budget-config"],
            });
            void queryClient.invalidateQueries({
                queryKey: ["budget-status"],
            });
        },
    });
}

// ── Agent Config ────────────────────────────────────────────

export function useAgentConfig(repositoryId: string | undefined) {
    return useQuery({
        queryKey: ["agent-config", repositoryId],
        queryFn: () => getAgentConfig(repositoryId!),
        enabled: !!repositoryId,
    });
}

export function useUpdateAgentConfig() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: ({
            repositoryId,
            ...fields
        }: {
            repositoryId: string;
            enabled?: boolean;
            scheduleMode?: ScheduleMode;
            scheduleWindowStart?: string;
            scheduleWindowEnd?: string;
            scanIntervalMinutes?: number;
            priority?: number;
        }) => updateAgentConfig(repositoryId, fields),
        onSuccess: (config) => {
            metrics.track("settings_changed", { setting: "agent_config" });
            void queryClient.invalidateQueries({
                queryKey: ["agent-config", config.repositoryId],
            });
        },
    });
}

// ── Engine Status ───────────────────────────────────────────

export function useEngineStatus() {
    return useQuery({
        queryKey: ["engine-status"],
        queryFn: () => invoke<EngineStatus>("engine_get_status"),
        refetchInterval: 5_000, // Refresh every 5 seconds when visible
    });
}

// ── Scanning ────────────────────────────────────────────────

export function useScanNow() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async ({
            repoPath,
            repositoryId,
            baseBranch,
        }: {
            repoPath: string;
            repositoryId: string;
            baseBranch?: string;
        }) => {
            console.log("scanNow", repoPath, repositoryId, baseBranch);
            // 1. Run the scan via Rust
            const result = await invoke<ScanResult>("engine_scan_now", {
                repoPath,
                repositoryId,
            });
            console.log("result", result);

            // 2. Progressively insert discovered tasks into the DB
            if (result.tasksFound.length > 0) {
                const { existingTitles, maxSortOrder } =
                    await getDeduplicationContext(repositoryId);
                let nextOrder = maxSortOrder;

                for (const scanned of result.tasksFound) {
                    const normalized = scanned.title.toLowerCase().trim();
                    if (existingTitles.has(normalized)) continue;

                    await createScannedTask(
                        repositoryId,
                        scanned,
                        ++nextOrder,
                        baseBranch,
                    );
                    existingTitles.add(normalized);

                    // Invalidate after each insertion so the UI updates progressively
                    await queryClient.invalidateQueries({
                        queryKey: ["tasks", repositoryId, baseBranch],
                    });
                }
            }

            return result;
        },
        onSuccess: (_result, variables) => {
            void queryClient.invalidateQueries({
                queryKey: ["agent-config", variables.repositoryId],
            });
        },
    });
}

// ── Deep Scan Event Listener ────────────────────────────────

/**
 * Listens for deep scan (Pass 2) completion events from the Rust backend.
 * When a deep scan finishes, tasks are already persisted in the DB —
 * we just need to invalidate the query cache so the UI refreshes.
 */
export function useDeepScanListener(repositoryId: string | undefined) {
    const queryClient = useQueryClient();

    useEffect(() => {
        if (!repositoryId) return;

        const unlisten = listen<{
            repositoryId: string;
            tasksFound: number;
            taskIds: string[];
        }>("agent:scan-deep-completed", (event) => {
            if (event.payload.repositoryId !== repositoryId) return;
            if (event.payload.tasksFound > 0) {
                console.log(
                    `[deep scan] ${event.payload.tasksFound} additional task(s) discovered`,
                );
                void queryClient.invalidateQueries({
                    queryKey: ["tasks", repositoryId],
                });
            }
        });

        return () => {
            void unlisten.then((fn) => fn());
        };
    }, [repositoryId, queryClient]);
}

// ── Task Event Listeners ─────────────────────────────────────

/**
 * Listens for agent task lifecycle events from the Rust backend.
 * Provides real-time UI updates as phases change, and acts as a
 * safety net for DB persistence (in case mutation callbacks fail).
 */
export function useTaskEventListeners(
    taskId: string | undefined,
    repositoryId: string | undefined,
) {
    const queryClient = useQueryClient();

    useEffect(() => {
        if (!taskId || !repositoryId) return;

        const unlisteners: Promise<() => void>[] = [];

        unlisteners.push(
            listen<{ taskId: string; repositoryId: string }>(
                "agent:task-started",
                (event) => {
                    if (event.payload.taskId !== taskId) return;
                    console.log("[event] agent:task-started", event.payload);
                    void queryClient.invalidateQueries({
                        queryKey: ["engine-status"],
                    });
                    void queryClient.invalidateQueries({
                        queryKey: ["task", taskId],
                    });
                },
            ),
        );

        unlisteners.push(
            listen<{
                taskId: string;
                repositoryId: string;
                branchName: string | null;
                commitSha: string | null;
            }>("agent:task-completed", (event) => {
                if (event.payload.taskId !== taskId) return;
                console.log("[event] agent:task-completed", event.payload);
                void queryClient.invalidateQueries({
                    queryKey: ["task", taskId],
                });
                void queryClient.invalidateQueries({
                    queryKey: ["tasks", repositoryId],
                });
                void queryClient.invalidateQueries({
                    queryKey: ["engine-status"],
                });
                void queryClient.invalidateQueries({
                    queryKey: ["budget-status"],
                });
            }),
        );

        unlisteners.push(
            listen<{
                taskId: string;
                repositoryId: string;
                error: string | null;
            }>("agent:task-failed", (event) => {
                if (event.payload.taskId !== taskId) return;
                console.log("[event] agent:task-failed", event.payload);
                void queryClient.invalidateQueries({
                    queryKey: ["task", taskId],
                });
                void queryClient.invalidateQueries({
                    queryKey: ["tasks", repositoryId],
                });
                void queryClient.invalidateQueries({
                    queryKey: ["engine-status"],
                });
            }),
        );

        return () => {
            for (const p of unlisteners) {
                void p.then((fn) => fn());
            }
        };
    }, [taskId, repositoryId, queryClient]);
}

// ── Working ─────────────────────────────────────────────────

export function useStartTask() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (params: {
            taskId: string;
            repositoryId: string;
            repoPath: string;
            taskTitle: string;
            taskDescription: string;
            filesInvolved: string[];
        }) => {
            console.log(
                "[useStartTask] invoking engine_start_task command — taskId:",
                params.taskId,
            );
            metrics.track("agent_run_started", { taskId: params.taskId });
            return invoke<WorkResult>("engine_start_task", params);
        },
        onSuccess: async (result, variables) => {
            console.log("[useStartTask] onSuccess — result:", result);
            metrics.track("agent_run_completed", {
                taskId: variables.taskId,
                success: result.success,
            });

            // Persist WorkResult fields to the task in DB
            try {
                if (result.success) {
                    console.log(
                        "[useStartTask] persisting success — branch:",
                        result.branchName,
                        "sha:",
                        result.commitSha,
                    );
                    await dbUpdateTask(variables.taskId, {
                        state: "review" as const,
                        branchName: result.branchName,
                        commitSha: result.commitSha,
                        completedAt: new Date().toISOString(),
                    });
                } else {
                    console.log(
                        "[useStartTask] persisting failure — error:",
                        result.error,
                    );
                    await dbUpdateTask(variables.taskId, {
                        state: "failed" as const,
                        lastError: result.error ?? "Unknown error",
                        branchName: result.branchName,
                    });
                }
            } catch (e) {
                console.error(
                    "[useStartTask] failed to persist WorkResult to DB:",
                    e,
                );
            }

            void queryClient.invalidateQueries({
                queryKey: ["tasks", variables.repositoryId],
            });
            void queryClient.invalidateQueries({
                queryKey: ["task", variables.taskId],
            });
            void queryClient.invalidateQueries({
                queryKey: ["engine-status"],
            });
            void queryClient.invalidateQueries({
                queryKey: ["budget-status"],
            });
        },
        onError: async (error, variables) => {
            console.error("[useStartTask] onError — mutation failed:", error);
            metrics.track("agent_run_completed", {
                taskId: variables.taskId,
                success: false,
            });

            // Task is stuck in in_progress — move to failed
            try {
                await dbUpdateTask(variables.taskId, {
                    state: "failed" as const,
                    lastError:
                        error instanceof Error ? error.message : String(error),
                });
            } catch (e) {
                console.error(
                    "[useStartTask] failed to persist error state to DB:",
                    e,
                );
            }

            void queryClient.invalidateQueries({
                queryKey: ["tasks", variables.repositoryId],
            });
            void queryClient.invalidateQueries({
                queryKey: ["task", variables.taskId],
            });
            void queryClient.invalidateQueries({
                queryKey: ["engine-status"],
            });
        },
    });
}

// ── Branch Operations ───────────────────────────────────────

export function usePushBranch() {
    return useMutation({
        mutationFn: ({
            repoPath,
            branchName,
        }: {
            repoPath: string;
            branchName: string;
        }) =>
            invoke<{ success: boolean; error?: string }>("engine_push_branch", {
                repoPath,
                branchName,
            }),
    });
}

// ── Diff ────────────────────────────────────────────────────

export interface DiffFileStat {
    file: string;
    additions: number;
    deletions: number;
}

export function useDiffStat(
    repoPath: string | undefined,
    baseBranch: string | undefined,
    headBranch: string | undefined,
) {
    return useQuery({
        queryKey: ["diff-stat", repoPath, baseBranch, headBranch],
        queryFn: () =>
            invoke<DiffFileStat[]>("engine_get_diff_stat", {
                repoPath,
                baseBranch,
                headBranch,
            }),
        enabled: !!repoPath && !!baseBranch && !!headBranch,
    });
}

export function useDiff(
    repoPath: string | undefined,
    baseBranch: string | undefined,
    headBranch: string | undefined,
) {
    return useQuery({
        queryKey: ["diff", repoPath, baseBranch, headBranch],
        queryFn: () =>
            invoke<string>("engine_get_diff", {
                repoPath,
                baseBranch,
                headBranch,
            }),
        enabled: !!repoPath && !!baseBranch && !!headBranch,
    });
}

// ── Startup Recovery ────────────────────────────────────────

/**
 * Recovers stale in_progress tasks on app startup.
 * Call once from the top-level app shell.
 */
export function useStartupRecovery() {
    const queryClient = useQueryClient();
    const recovered = useRef(false);

    useEffect(() => {
        if (recovered.current) return;
        recovered.current = true;

        void recoverStaleTasks().then((count) => {
            if (count > 0) {
                console.log(
                    `Recovered ${count} stale task(s) from previous session`,
                );
                // Invalidate all task queries so the UI reflects the reset states
                void queryClient.invalidateQueries({
                    queryKey: ["tasks"],
                });
            }
        });
    }, [queryClient]);
}
