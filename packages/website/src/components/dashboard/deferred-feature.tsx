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

class FeatureBoundary extends Component<
  { retry: () => void; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <div className="app-error" role="alert">
        This view could not be opened.{" "}
        <button className="text-button" onClick={this.props.retry}>
          Try opening again
        </button>
      </div>
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
        retry={() => setAttempt((value) => value + 1)}
      >
        <Suspense
          fallback={
            <p role="status" className={`library-loading ${loadingClass}`}>
              {label}
            </p>
          }
        >
          <Feature {...props} />
        </Suspense>
      </FeatureBoundary>
    );
  }
  return Deferred;
}
