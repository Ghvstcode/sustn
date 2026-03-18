import { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";
import { metrics } from "@core/services/metrics";

interface Props {
    children: ReactNode;
}

interface State {
    hasError: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
    constructor(props: Props) {
        super(props);
        this.state = { hasError: false };
    }

    static getDerivedStateFromError(): State {
        return { hasError: true };
    }

    componentDidCatch(error: Error, errorInfo: ErrorInfo) {
        console.error("Uncaught render error:", error, errorInfo);
        metrics.track("app_crash", {
            error: error.message,
            stack: error.stack,
            componentStack: errorInfo.componentStack,
        });
    }

    render() {
        if (this.state.hasError) {
            return (
                <div className="flex h-screen w-screen flex-col items-center justify-center gap-4 bg-background p-8 text-foreground">
                    <h1 className="text-xl font-semibold">
                        Something went wrong
                    </h1>
                    <p className="max-w-md text-center text-sm text-muted-foreground">
                        The app encountered an unexpected error. Your data is
                        safe — click below to reload.
                    </p>
                    <button
                        onClick={() => window.location.reload()}
                        className="mt-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
                    >
                        Reload
                    </button>
                </div>
            );
        }

        return this.props.children;
    }
}
