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
  loadingClass = "",
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
        loadingClass={loadingClass}
        retry={() => setAttempt((value) => value + 1)}
      >
        <Suspense
          fallback={<LoadingState label={label} className={loadingClass} />}
        >
          <Feature {...props} />
        </Suspense>
      </FeatureBoundary>
    );
  }
  return Deferred;
}
