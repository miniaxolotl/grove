"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import {
  ReactFlow,
  Background,
  Controls,
  type Node,
  type Edge,
} from "@xyflow/react";
import type { NoteConnection } from "@lib/shared/relationships";
import type { Project } from "@/lib/dashboard-api";
import {
  ConnectionList,
  ConnectionInspector,
  ConnectionStatus,
  useConnections,
} from "./connection-panel";
import "@xyflow/react/dist/style.css";

export function NotebookGraph({ projects }: { projects: Project[] }) {
  const router = useRouter();
  const [selected, setSelected] = useState<Project>();
  const [inspected, setInspected] = useState<NoteConnection>();
  const [offset, setOffset] = useState(0);
  const start = Math.min(
    offset,
    Math.max(0, Math.floor((projects.length - 1) / 100) * 100),
  );
  const loaded = useMemo(
    () => projects.slice(start, start + 100),
    [projects, start],
  );
  const connections = useConnections({
    level: "notebook",
    endpointIds: loaded.map((p) => p.id).sort(),
    limit: 100,
  });
  const nodes: Node[] = useMemo(
    () =>
      [...loaded]
        .sort((a, b) => a.id.localeCompare(b.id))
        .map((p, index) => ({
          id: p.id,
          position: {
            x:
              Math.cos((index / loaded.length) * Math.PI * 2) *
              Math.max(180, loaded.length * 35),
            y:
              Math.sin((index / loaded.length) * Math.PI * 2) *
              Math.max(140, loaded.length * 28),
          },
          data: { label: p.name },
          className: "notebook-graph-node",
          ariaLabel: `${p.name}. Press Enter to open notebook.`,
          style: { width: 180 },
        })),
    [loaded],
  );
  const items = connections.page?.items ?? [];
  const edges: Edge[] = items.map((c) => ({
    id: c.id,
    source: c.from.id,
    target: c.to.id,
    interactionWidth: 24,
    type: "smoothstep",
    className: "notebook-connection",
    ariaLabel: `${c.from.title} and ${c.to.title}. Press Enter for evidence.`,
  }));
  const inspect = (id: string) => setInspected(items.find((c) => c.id === id));
  return (
    <section className="memory-graph" aria-label="Connected notebooks graph">
      <div className="graph-toolbar">
        <div className="graph-heading">
          <div>
            <strong>Connected notebooks</strong>
            <span>
              {loaded.length} notebooks · {items.length}
              {connections.page?.nextCursor ? "+" : ""}{" "}
              {items.length === 1 ? "connection" : "connections"}
            </span>
          </div>
        </div>
      </div>
      <div className={`graph-layout${selected ? " has-selection" : ""}`}>
        <div
          className="graph-canvas"
          onKeyDownCapture={(event) => {
            const target = event.target as HTMLElement;
            if (event.key !== "Enter" && event.key !== " ") return;
            const edge = target
              .closest(".react-flow__edge")
              ?.getAttribute("data-id");
            const node = target
              .closest(".react-flow__node")
              ?.getAttribute("data-id");
            if (!edge && !node) return;
            event.preventDefault();
            event.stopPropagation();
            if (edge) inspect(edge);
            else if (node && event.key === "Enter")
              router.push(`/app/projects/${node}`);
            else setSelected(loaded.find((p) => p.id === node));
          }}
        >
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodesConnectable={false}
            nodesDraggable={false}
            deleteKeyCode={null}
            onNodeClick={(_, node) =>
              setSelected(loaded.find((p) => p.id === node.id))
            }
            onNodeDoubleClick={(_, node) =>
              router.push(`/app/projects/${node.id}`)
            }
            onEdgeClick={(_, edge) => inspect(edge.id)}
            fitView
            fitViewOptions={{ padding: 0.25, maxZoom: 1 }}
            minZoom={0.1}
            aria-label="Explore your notebooks"
          >
            <Background gap={28} />
            <Controls showInteractive={false} />
          </ReactFlow>
        </div>
        {selected && (
          <aside className="graph-inspector" aria-label="Selected notebook">
            <div className="graph-inspector-heading">
              <span>Notebook</span>
              <button
                className="app-icon"
                aria-label="Clear graph selection"
                onClick={() => setSelected(undefined)}
              >
                <X size={16} />
              </button>
            </div>
            <h3>{selected.name}</h3>
            <Link
              className="app-button secondary"
              href={`/app/projects/${selected.id}`}
            >
              Open notebook
            </Link>
            <ConnectionList
              items={items.filter(
                (c) => c.from.id === selected.id || c.to.id === selected.id,
              )}
              endpointId={selected.id}
              onInspect={setInspected}
            />
          </aside>
        )}
      </div>
      {projects.length > 100 && (
        <p className="graph-notice">
          Notebooks {start + 1}–{Math.min(start + 100, projects.length)} of{" "}
          {projects.length}.
        </p>
      )}
      {projects.length > 100 && (
        <nav className="connection-actions" aria-label="Graph notebook pages">
          <button
            className="text-button"
            disabled={!start}
            onClick={() => {
              setSelected(undefined);
              setOffset(start - 100);
            }}
          >
            Previous notebooks
          </button>
          <button
            className="text-button"
            disabled={start + 100 >= projects.length}
            onClick={() => {
              setSelected(undefined);
              setOffset(start + 100);
            }}
          >
            Next notebooks
          </button>
        </nav>
      )}
      <details className="graph-connection-list">
        <summary>Connection list</summary>
        <ConnectionStatus state={connections} />
        <ConnectionList items={items} onInspect={setInspected} />
        {connections.page?.nextCursor && (
          <button
            className="text-button"
            disabled={connections.loading}
            onClick={() => void connections.more()}
          >
            More connections
          </button>
        )}
      </details>
      {inspected && (
        <ConnectionInspector
          connection={inspected}
          close={() => setInspected(undefined)}
        />
      )}
    </section>
  );
}
