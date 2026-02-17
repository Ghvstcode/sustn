import { BrowserRouter as Router, Route, Routes } from "react-router-dom";
import "./App.css";
import { ThemeProvider } from "@ui/providers/ThemeProvider";
import { AppProvider } from "@ui/providers/AppProvider";
import { AppShell } from "@ui/components/layout/AppShell";
import { Toaster } from "sonner";
import { useTheme } from "@ui/hooks/useTheme";
import {
    QueryClient,
    QueryClientProvider,
    MutationCache,
} from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";

const mutationCache = new MutationCache({
    onError: (error) => {
        console.error("Mutation error:", error);
    },
});

const queryClient = new QueryClient({
    mutationCache,
    defaultOptions: {
        queries: {
            retry: false,
            networkMode: "always",
            refetchOnWindowFocus: false,
            staleTime: Infinity,
        },
    },
});

function AppContent() {
    const { mode } = useTheme();

    const resolvedTheme =
        mode === "system"
            ? window.matchMedia("(prefers-color-scheme: dark)").matches
                ? "dark"
                : "light"
            : mode;

    return (
        <div className="select-none bg-background">
            <AppShell>
                <Routes>
                    <Route
                        path="/"
                        element={
                            <div className="flex items-center justify-center h-full">
                                <h1 className="text-2xl text-muted-foreground">
                                    Welcome to SUSTN
                                </h1>
                            </div>
                        }
                    />
                </Routes>
            </AppShell>
            <Toaster
                theme={resolvedTheme}
                position="bottom-right"
                closeButton
            />
        </div>
    );
}

function App() {
    return (
        <QueryClientProvider client={queryClient}>
            <Router>
                <ThemeProvider storageKey="sustn-theme">
                    <AppProvider>
                        <AppContent />
                    </AppProvider>
                </ThemeProvider>
            </Router>
            <ReactQueryDevtools initialIsOpen={false} />
        </QueryClientProvider>
    );
}

export default App;
