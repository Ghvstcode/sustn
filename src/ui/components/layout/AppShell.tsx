interface AppShellProps {
    children: React.ReactNode;
}

export function AppShell({ children }: AppShellProps) {
    return (
        <div className="flex h-screen w-screen overflow-hidden">
            <aside className="w-64 border-r border-border bg-sidebar flex flex-col">
                <div className="p-4 border-b border-sidebar-border">
                    <h1 className="text-lg font-semibold text-sidebar-foreground">
                        sustn
                    </h1>
                </div>
                <nav className="flex-1 p-2">
                    <p className="text-sm text-sidebar-foreground/60 p-2">
                        No repositories yet
                    </p>
                </nav>
            </aside>
            <main className="flex-1 overflow-auto">{children}</main>
        </div>
    );
}
