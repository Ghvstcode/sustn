import { create } from "zustand";

// Will hold client-side state as features are built
// Examples: selectedRepoId, isSidebarCollapsed, activeView
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
interface AppStore {}

export const useAppStore = create<AppStore>()(() => ({}));
