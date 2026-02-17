import { create } from "zustand";

interface AppStore {
    selectedRepositoryId: string | undefined;
    selectedTaskId: string | undefined;
    setSelectedRepository: (id: string | undefined) => void;
    setSelectedTask: (id: string | undefined) => void;
}

export const useAppStore = create<AppStore>()((set) => ({
    selectedRepositoryId: undefined,
    selectedTaskId: undefined,
    setSelectedRepository: (id) =>
        set({ selectedRepositoryId: id, selectedTaskId: undefined }),
    setSelectedTask: (id) => set({ selectedTaskId: id }),
}));
