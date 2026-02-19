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
} from "@core/db/tasks";
import type {
    BudgetConfig,
    BudgetStatus,
    EngineStatus,
    ScanResult,
    ScheduleMode,
    WorkResult,
} from "@core/types/agent";

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
        }) => invoke<WorkResult>("engine_start_task", params),
        onSuccess: (_result, variables) => {
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
    });
}

// ── Controls ────────────────────────────────────────────────

export function usePauseAgent() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (repositoryId?: string) =>
            invoke("engine_pause", { repositoryId }),
        onSuccess: () => {
            void queryClient.invalidateQueries({
                queryKey: ["engine-status"],
            });
            void queryClient.invalidateQueries({
                queryKey: ["agent-config"],
            });
        },
    });
}

export function useResumeAgent() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (repositoryId?: string) =>
            invoke("engine_resume", { repositoryId }),
        onSuccess: () => {
            void queryClient.invalidateQueries({
                queryKey: ["engine-status"],
            });
            void queryClient.invalidateQueries({
                queryKey: ["agent-config"],
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
