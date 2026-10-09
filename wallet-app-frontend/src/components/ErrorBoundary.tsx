import { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";
import { Button } from "./ui/Button";
import { TILE_GLYPH, TILE_STROKE } from "../lib/tiles";
import { IconTile } from "./ui/IconTile";
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
        <div className="w-full max-w-sm rounded-[14px] border-[1.5px] border-ink-900/75 bg-paper-25 p-6 text-center shadow-[0_24px_60px_-34px_rgba(15,15,13,0.5)]">
          <IconTile tone="seal" scale="lg" className="mx-auto">
            <IconWarning size={TILE_GLYPH.lg + 2} strokeWidth={TILE_STROKE} />
          </IconTile>
          <h1 className="mt-4 font-display text-[18px] font-bold tracking-tight text-ink-900">
            Something broke on this screen
          </h1>
          <p className="mt-1.5 text-[13px] leading-relaxed text-ink-500">
            The rest of the app is unaffected. Reloading usually clears it.
          </p>
          <pre className="mt-4 max-h-24 overflow-auto rounded-[8px] bg-paper-100 p-3 text-left font-mono text-[11px] break-words whitespace-pre-wrap text-ink-600">
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
