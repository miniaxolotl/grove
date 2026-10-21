export default function LoadingWorkspace() {
  return (
    <div className="memory-workspace" aria-busy="true">
      <p role="status" className="library-loading">
        Opening your workspace…
      </p>
    </div>
  );
}
