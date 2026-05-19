"use client";

import React, { Component, type ReactNode, type ErrorInfo } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

interface Props {
  children: ReactNode;
  /** A short label shown in the fallback (e.g. "Chart", "Feed") */
  label?: string;
  /** Optional custom fallback element */
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

/**
 * Production-grade React error boundary.
 *
 * Wraps child components so a runtime crash only affects the bounded subtree,
 * not the entire dashboard. Shows a minimal fallback with a retry button and
 * logs structured diagnostics to the console.
 */
export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.group(`[ErrorBoundary] 💥 Crash in <${this.props.label ?? "Component"}>`);
    console.error("Error:", error);
    console.error("Component stack:", info.componentStack);
    console.groupEnd();
  }

  private handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    if (this.props.fallback) {
      return this.props.fallback;
    }

    return (
      <div className="error-boundary-fallback" role="alert">
        <AlertTriangle className="w-6 h-6 text-red-400" />
        <h3>{this.props.label ?? "Component"} encountered an error</h3>
        <p>{this.state.error?.message ?? "Unknown error"}</p>
        <button onClick={this.handleRetry}>
          <RefreshCw className="w-3 h-3 inline mr-1" />
          Retry
        </button>
      </div>
    );
  }
}
