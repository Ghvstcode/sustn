import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
    listTasks,
    getTask,
    createTask as dbCreateTask,
    updateTask as dbUpdateTask,
    deleteTask as dbDeleteTask,
    reorderTask as dbReorderTask,
} from "@core/db/tasks";
import type { Task, TaskCategory, TaskState } from "@core/types/task";

export function useTasks(repositoryId: string | undefined) {
    return useQuery({
        queryKey: ["tasks", repositoryId],
        queryFn: () => listTasks(repositoryId!),
        enabled: !!repositoryId,
    });
}

export function useTask(taskId: string | undefined) {
    return useQuery({
        queryKey: ["task", taskId],
        queryFn: () => getTask(taskId!),
        enabled: !!taskId,
    });
}

export function useCreateTask() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (task: {
            repositoryId: string;
            title: string;
            description?: string;
            category: TaskCategory;
            sortOrder: number;
        }) => dbCreateTask(task),
        onSuccess: (task) => {
            void queryClient.invalidateQueries({
                queryKey: ["tasks", task.repositoryId],
            });
        },
    });
}

export function useUpdateTask() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: ({
            id,
            ...fields
        }: {
            id: string;
            title?: string;
            description?: string;
            state?: TaskState;
            sortOrder?: number;
            notes?: string;
            prUrl?: string;
            category?: TaskCategory;
        }) => dbUpdateTask(id, fields),
        onSuccess: (task) => {
            void queryClient.invalidateQueries({
                queryKey: ["tasks", task.repositoryId],
            });
            void queryClient.invalidateQueries({
                queryKey: ["task", task.id],
            });
        },
    });
}

export function useDeleteTask() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: ({ id }: { id: string; repositoryId: string }) =>
            dbDeleteTask(id),
        onSuccess: (_data, variables) => {
            void queryClient.invalidateQueries({
                queryKey: ["tasks", variables.repositoryId],
            });
        },
    });
}

export function useReorderTask() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: ({
            id,
            newSortOrder,
        }: {
            id: string;
            repositoryId: string;
            newSortOrder: number;
        }) => dbReorderTask(id, newSortOrder),
        onMutate: async ({ id, repositoryId, newSortOrder }) => {
            await queryClient.cancelQueries({
                queryKey: ["tasks", repositoryId],
            });

            const previousTasks = queryClient.getQueryData<Task[]>([
                "tasks",
                repositoryId,
            ]);

            queryClient.setQueryData<Task[]>(["tasks", repositoryId], (old) => {
                if (!old) return old;
                return old
                    .map((t) =>
                        t.id === id ? { ...t, sortOrder: newSortOrder } : t,
                    )
                    .sort((a, b) => a.sortOrder - b.sortOrder);
            });

            return { previousTasks };
        },
        onError: (_err, variables, context) => {
            if (context?.previousTasks) {
                queryClient.setQueryData(
                    ["tasks", variables.repositoryId],
                    context.previousTasks,
                );
            }
        },
        onSettled: (_data, _error, variables) => {
            void queryClient.invalidateQueries({
                queryKey: ["tasks", variables.repositoryId],
            });
        },
    });
}
