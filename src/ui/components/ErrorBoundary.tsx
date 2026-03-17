import React from "react";
import { Button } from "@ui/components/ui/button";

interface ErrorBoundaryProps {
    children: React.ReactNode;
}

interface ErrorBoundaryState {
    hasError: boolean;
    error: Error | undefined;
}

export class ErrorBoundary extends React.Component<
    ErrorBoundaryProps,
    ErrorBoundaryState
> {
    constructor(props: ErrorBoundaryProps) {
        super(props);
        this.state = { hasError: false, error: undefined };
    }

    static getDerivedStateFromError(error: Error): ErrorBoundaryState {
        return { hasError: true, error };
    }

    componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
        console.error("[ErrorBoundary] Uncaught error:", error, errorInfo);
    }

    handleReset = (): void => {
        this.setState({ hasError: false, error: undefined });
    };

    handleReload = (): void => {
        window.location.reload();
    };

    render(): React.ReactNode {
        if (this.state.hasError) {
            return (
                <div className="flex h-screen w-screen items-center justify-center bg-background p-8">
                    <div className="flex max-w-md flex-col items-center gap-4 text-center">
                        <h2 className="text-lg font-semibold text-foreground">
                            Something went wrong
                        </h2>
                        <p className="text-sm text-muted-foreground">
                            An unexpected error occurred. You can try to recover
                            or reload the app.
                        </p>
                        {this.state.error && (
                            <pre className="max-h-32 w-full overflow-auto rounded-md bg-muted p-3 text-left text-xs text-muted-foreground">
                                {this.state.error.message}
                            </pre>
                        )}
                        <div className="flex gap-2">
                            <Button
                                variant="outline"
                                onClick={this.handleReset}
                            >
                                Try again
                            </Button>
                            <Button onClick={this.handleReload}>
                                Reload app
                            </Button>
                        </div>
                    </div>
                </div>
            );
        }

        return this.props.children;
    }
}
