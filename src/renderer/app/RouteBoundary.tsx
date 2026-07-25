import { Component, type ErrorInfo, type ReactNode } from "react";
import styles from "./App.module.css";
import { Control, Notice, Text } from "../../ui/components/index.js";

interface RouteBoundaryProps {
  children: ReactNode;
  title: string;
  detail: string;
  retryLabel: string;
}

interface RouteBoundaryState { failed: boolean }

/** Keeps the application shell usable when one task contains malformed content. */
export class RouteBoundary extends Component<RouteBoundaryProps, RouteBoundaryState> {
  state: RouteBoundaryState = { failed: false };

  static getDerivedStateFromError(): RouteBoundaryState { return { failed: true }; }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("[route-render-failed]", error.stack || error.message, info.componentStack);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return <Notice tone="danger" density="compact" className={styles.routeError} role="alert">
      <Text as="strong" weight="semibold">{this.props.title}</Text>
      <Text tone="secondary">{this.props.detail}</Text>
      <Control recipe="quiet" tone="danger" onClick={() => window.location.reload()}>{this.props.retryLabel}</Control>
    </Notice>;
  }
}
