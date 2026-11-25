import { Component } from "react";
import type { ReactNode } from "react";
import { logError } from "../shared/lib/logger";
import { FailureState } from "../shared/ui/FailureState";

export class ErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch() {
    logError("app.failure");
  }

  render() {
    return this.state.failed ? <FailureState /> : this.props.children;
  }
}
