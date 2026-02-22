import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
    getGlobalSettings,
    updateGlobalSetting,
    getProjectOverrides,
    updateProjectOverride,
    clearProjectOverride,
    removeProject,
} from "@core/db/settings";
import type { GlobalSettings, ProjectOverrides } from "@core/types/settings";
import { metrics } from "@core/services/metrics";
import { savedToast } from "@ui/lib/toast";

// ── Global Settings ────────────────────────────────────────

export function useGlobalSettings() {
    return useQuery({
        queryKey: ["global-settings"],
        queryFn: getGlobalSettings,
    });
}

export function useUpdateGlobalSetting() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: ({
            key,
            value,
        }: {
            key: keyof GlobalSettings;
            value: unknown;
        }) => updateGlobalSetting(key, value),
        onSuccess: (_data, variables) => {
            metrics.track("settings_changed", { setting: variables.key });
            savedToast();
            void queryClient.invalidateQueries({
                queryKey: ["global-settings"],
            });
        },
    });
}

// ── Project Overrides ──────────────────────────────────────

export function useProjectOverrides(repositoryId: string | undefined) {
    return useQuery({
        queryKey: ["project-overrides", repositoryId],
        queryFn: () => getProjectOverrides(repositoryId!),
        enabled: !!repositoryId,
    });
}

export function useUpdateProjectOverride() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: ({
            repositoryId,
            field,
            value,
        }: {
            repositoryId: string;
            field: keyof Omit<ProjectOverrides, "repositoryId">;
            value: unknown;
        }) => updateProjectOverride(repositoryId, field, value),
        onSuccess: (_data, variables) => {
            metrics.track("settings_changed", {
                setting: `project.${variables.field}`,
            });
            savedToast();
            void queryClient.invalidateQueries({
                queryKey: ["project-overrides", variables.repositoryId],
            });
        },
    });
}

export function useClearProjectOverride() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: ({
            repositoryId,
            field,
        }: {
            repositoryId: string;
            field: keyof Omit<ProjectOverrides, "repositoryId">;
        }) => clearProjectOverride(repositoryId, field),
        onSuccess: (_data, variables) => {
            savedToast();
            void queryClient.invalidateQueries({
                queryKey: ["project-overrides", variables.repositoryId],
            });
        },
    });
}

export function useRemoveProject() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (repositoryId: string) => removeProject(repositoryId),
        onSuccess: () => {
            void queryClient.invalidateQueries({
                queryKey: ["repositories"],
            });
            void queryClient.invalidateQueries({
                queryKey: ["project-overrides"],
            });
            void queryClient.invalidateQueries({
                queryKey: ["global-settings"],
            });
        },
    });
}
