import { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";
import { Button } from "./ui/Button";
import { IconRefresh, IconWarning } from "./ui/Icons";

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * Last line of defence: an unexpected render error shows a recoverable screen
 * instead of a blank white page.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // A real deployment would forward this to an error tracker.
    console.error("Unhandled UI error", error, info.componentStack);
  }

  override render(): ReactNode {
    if (!this.state.error) return this.props.children;

    return (
      <div className="flex min-h-dvh items-center justify-center p-6">
        <div className="w-full max-w-sm rounded-3xl bg-white p-6 text-center shadow-xl ring-1 ring-slate-900/5">
          <span className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-rose-50 text-rose-600">
            <IconWarning size={24} />
          </span>
          <h1 className="mt-4 text-[17px] font-bold text-slate-900">
            Something broke on this screen
          </h1>
          <p className="mt-1.5 text-[13px] leading-relaxed text-slate-500">
            The rest of the app is unaffected. Reloading usually clears it.
          </p>
          <pre className="mt-4 max-h-24 overflow-auto rounded-xl bg-slate-50 p-3 text-left text-[11px] break-words whitespace-pre-wrap text-slate-500">
            {this.state.error.message}
          </pre>
          <div className="mt-5 flex gap-2">
            <Button
              variant="secondary"
              fullWidth
              onClick={() => this.setState({ error: null })}
            >
              Dismiss
            </Button>
            <Button
              fullWidth
              onClick={() => window.location.reload()}
              leftIcon={<IconRefresh size={16} />}
            >
              Reload
            </Button>
          </div>
        </div>
      </div>
    );
  }
}
