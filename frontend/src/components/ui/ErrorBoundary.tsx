import React, { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
  moduleName?: string;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error(`[${this.props.moduleName || 'ErrorBoundary'}]`, error, errorInfo);
  }

  handleRetry = (): void => {
    this.setState({ hasError: false, error: null });
  };

  render(): ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="error-boundary">
          <div className="error-boundary__icon">⚠️</div>
          <div className="error-boundary__title">{this.props.moduleName ? `${this.props.moduleName} 出错` : '出现错误'}</div>
          <div className="error-boundary__message">{this.state.error?.message || '发生了未知错误'}</div>
          <button className="btn btn--primary" onClick={this.handleRetry}>重试</button>
        </div>
      );
    }

    return this.props.children;
  }
}

interface NodeErrorBoundaryProps {
  children: ReactNode;
  nodeId: string;
  nodeType: string;
}

export class NodeErrorBoundary extends Component<NodeErrorBoundaryProps, State> {
  constructor(props: NodeErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error(`[NodeErrorBoundary:${this.props.nodeId}]`, error, errorInfo);
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div className="node-error">
          <div className="node-error__icon">❌</div>
          <div className="node-error__text">{this.state.error?.message || '节点错误'}</div>
        </div>
      );
    }

    return this.props.children;
  }
}

export function withErrorBoundary<P extends object>(WrappedComponent: React.ComponentType<P>, moduleName: string): React.ComponentType<P> {
  const displayName = WrappedComponent.displayName || WrappedComponent.name || 'Component';

  const ComponentWithErrorBoundary = (props: P): JSX.Element => (
    <ErrorBoundary moduleName={moduleName}>
      <WrappedComponent {...props} />
    </ErrorBoundary>
  );

  ComponentWithErrorBoundary.displayName = `withErrorBoundary(${displayName})`;
  return ComponentWithErrorBoundary;
}
