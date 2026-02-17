import { Sidebar } from "@ui/components/sidebar/Sidebar";
import { MainContent } from "@ui/components/main/MainContent";

export function AppShell() {
    return (
        <div className="flex h-screen w-screen overflow-hidden">
            <Sidebar />
            <main className="flex-1 overflow-hidden">
                <MainContent />
            </main>
        </div>
    );
}
