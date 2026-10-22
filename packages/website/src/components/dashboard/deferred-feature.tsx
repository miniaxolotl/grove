"use client";
import {
  Component,
  Suspense,
  lazy,
  useMemo,
  useState,
  type ComponentType,
  type ReactNode,
} from "react";
import { LoadingState } from "./loading-state";

class FeatureBoundary extends Component<
  {
    retry: () => void;
    children: ReactNode;
    label: string;
    loadingClass: string;
    failureTitle?: string;
    failureDescription?: string;
  },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <LoadingState
        label={this.props.label}
        className={this.props.loadingClass}
        failed
        failureTitle={this.props.failureTitle}
        failureDescription={this.props.failureDescription}
        retry={this.props.retry}
      />
    ) : (
      this.props.children
    );
  }
}

/** Recreate React's lazy promise after failure so a transient chunk error can retry in place. */
export function deferredFeature<P extends object>(
  load: () => Promise<{ default: ComponentType<P> }>,
  label: string,
  {
    className = "",
    failureTitle,
    failureDescription,
  }: {
    className?: string;
    failureTitle?: string;
    failureDescription?: string;
  } = {},
) {
  function Deferred(props: P) {
    const [attempt, setAttempt] = useState(0);
    const Feature = useMemo(() => {
      void attempt;
      return lazy(load);
    }, [attempt]);
    return (
      <FeatureBoundary
        key={attempt}
        label={label}
        loadingClass={className}
        failureTitle={failureTitle}
        failureDescription={failureDescription}
        retry={() => setAttempt((value) => value + 1)}
      >
        <Suspense
          fallback={<LoadingState label={label} className={className} />}
        >
          <Feature {...props} />
        </Suspense>
      </FeatureBoundary>
    );
  }
  return Deferred;
}
