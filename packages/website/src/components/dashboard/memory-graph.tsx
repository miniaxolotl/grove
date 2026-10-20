"use client";
import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  Handle,
  Position,
  useNodesState,
  useNodesInitialized,
  useReactFlow,
  type Node,
  type NodeProps,
  type Edge,
} from "@xyflow/react";
import {
  forceSimulation,
  forceLink,
  forceManyBody,
  forceCollide,
  forceX,
  forceY,
  type SimulationNodeDatum,
} from "d3-force";
import { ArrowUpRight, BookOpen, Network, X } from "lucide-react";
import type { Memory } from "@lib/shared/contracts";
import type { Project } from "@/lib/dashboard-api";
import {
  memoryTitle,
  memoryExcerpt,
  noteKindLabel,
} from "@/lib/memory-display";
import { Button } from "./ui/button";
import "@xyflow/react/dist/style.css";

type Relationship = "complementary" | "duplicate" | "conflicting";
const labels: Record<Relationship, string> = {
  complementary: "Related",
  duplicate: "Possible duplicate",
  conflicting: "Conflicting",
};
const colors: Record<Relationship, string> = {
  complementary: "#879a87",
  duplicate: "#827394",
  conflicting: "#ad7358",
};
type GraphNode = Node<{ memory: Memory; project: string }, "memory">;
function MemoryNode({ data }: NodeProps<GraphNode>) {
  return (
    <div className="graph-memory-node">
      <Handle type="target" position={Position.Left} />
      <span className="graph-node-kind">
        <BookOpen size={12} />
        {noteKindLabel(data.memory.kind)}
      </span>
      <strong>{memoryTitle(data.memory)}</strong>
      <span className="graph-node-project">{data.project}</span>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
const nodeTypes = { memory: MemoryNode };
function graphEdges(items: Memory[]): Edge[] {
  const edges = new Map<string, Edge>();
  for (const memory of items)
    for (const relation of memory.enrichment?.relationships ?? []) {
      if (
        relation.relationship === "unrelated" ||
        relation.id === memory.id ||
        !items.some(
          (other) =>
            other.id === relation.id &&
            other.version === relation.version &&
            other.projectId === memory.projectId,
        )
      )
        continue;
      const [source, target] = [memory.id, relation.id].sort();
      const id = `${source}:${target}:${relation.relationship}`;
      edges.set(id, {
        id,
        source,
        target,
        type: "default",
        data: { relationship: relation.relationship },
        ariaLabel: `${labels[relation.relationship]}: ${memoryTitle(memory)} and ${memoryTitle(items.find((item) => item.id === relation.id)!)}`,
        style: {
          stroke: colors[relation.relationship],
          strokeWidth: 1.5,
          strokeDasharray:
            relation.relationship === "duplicate" ? "5 4" : undefined,
        },
      });
    }
  return [...edges.values()];
}
function layout(
  items: Memory[],
  projects: Project[],
  edges: Edge[],
): GraphNode[] {
  const scopes = [...new Set(items.map((item) => item.projectId))];
  const particles: (SimulationNodeDatum & { id: string; group: number })[] =
    items.map((item) => ({
      id: item.id,
      group: scopes.indexOf(item.projectId),
    }));
  const simulation = forceSimulation(particles)
    .stop()
    .force(
      "links",
      forceLink(
        edges.map((edge) => ({ source: edge.source, target: edge.target })),
      )
        .id((node) => (node as (typeof particles)[number]).id)
        .distance(300)
        .strength(0.3),
    )
    .force("charge", forceManyBody().strength(-1100))
    .force("collide", forceCollide(135).iterations(3))
    .force(
      "x",
      forceX<(typeof particles)[number]>(
        (node) => (node.group % 3) * 850,
      ).strength(0.08),
    )
    .force(
      "y",
      forceY<(typeof particles)[number]>(
        (node) => Math.floor(node.group / 3) * 700,
      ).strength(0.08),
    );
  simulation.tick(220);
  return items.map((memory, index) => ({
    id: memory.id,
    type: "memory",
    position: { x: particles[index].x! - 100, y: particles[index].y! - 55 },
    data: {
      memory,
      project:
        projects.find((project) => project.id === memory.projectId)?.name ??
        "Personal",
    },
    ariaLabel: `${memoryTitle(memory)}. ${noteKindLabel(memory.kind)}. Press Enter to read.`,
    width: 200,
    height: 110,
  }));
}
export default function MemoryGraph({
  items,
  projects,
  onOpen,
}: {
  items: Memory[];
  projects: Project[];
  onOpen: (memory: Memory) => void;
}) {
  const [relationship, setRelationship] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const edges = useMemo(() => graphEdges(items), [items]);
  const visibleEdges = relationship
    ? edges.filter((edge) => edge.data?.relationship === relationship)
    : edges;
  const visibleItems = relationship
    ? items.filter((item) =>
        visibleEdges.some(
          (edge) => edge.source === item.id || edge.target === item.id,
        ),
      )
    : items;
  const active = items.find((item) => item.id === selected);
  const neighbors = new Set(
    visibleEdges
      .filter((edge) => edge.source === selected || edge.target === selected)
      .flatMap((edge) => [edge.source, edge.target]),
  );
  const initialNodes = useMemo(
    () => layout(items, projects, edges),
    [items, projects, edges],
  );
  return (
    <section className="memory-graph" aria-label="Linked notes graph">
      <div className="graph-toolbar">
        <span>
          <Network size={15} />
          {visibleItems.length} notes · {visibleEdges.length}{" "}
          {visibleEdges.length === 1 ? "connection" : "connections"}
        </span>
        <label>
          Show
          <select
            aria-label="Graph relationships"
            value={relationship}
            onChange={(event) => {
              setRelationship(event.target.value);
              setSelected(null);
            }}
          >
            <option value="">All connections</option>
            {Object.entries(labels).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className={`graph-layout${active ? " has-selection" : ""}`}>
        <div className="graph-canvas">
          <Canvas
            key={`${items.map((item) => `${item.id}:${item.version}`).join()}:${relationship}`}
            initialNodes={initialNodes.filter((node) =>
              visibleItems.some((item) => item.id === node.id),
            )}
            edges={visibleEdges}
            selected={selected}
            neighbors={neighbors}
            onSelect={setSelected}
            onOpen={onOpen}
          />
          {!visibleEdges.length && (
            <p className="graph-hint">
              {relationship
                ? "No matching connections here."
                : "Connections appear as Grove finds related ideas."}
            </p>
          )}
        </div>
        {active && (
          <aside className="graph-inspector" aria-label="Selected note">
            <div className="graph-inspector-heading">
              <span>{noteKindLabel(active.kind)}</span>
              <button
                className="app-icon"
                aria-label="Clear graph selection"
                onClick={() => setSelected(null)}
              >
                <X size={16} />
              </button>
            </div>
            <h3>{memoryTitle(active)}</h3>
            <p>{memoryExcerpt(active, 260)}</p>
            <Button variant="secondary" onClick={() => onOpen(active)}>
              Read note
              <ArrowUpRight size={15} />
            </Button>
            <h4>Linked notes</h4>
            <ul>
              {visibleEdges
                .filter(
                  (edge) =>
                    edge.source === active.id || edge.target === active.id,
                )
                .map((edge) => {
                  const other = items.find(
                    (item) =>
                      item.id ===
                      (edge.source === active.id ? edge.target : edge.source),
                  )!;
                  return (
                    <li key={edge.id}>
                      <button onClick={() => setSelected(other.id)}>
                        <small>
                          {labels[edge.data!.relationship as Relationship]}
                        </small>
                        <span>{memoryTitle(other)}</span>
                      </button>
                    </li>
                  );
                })}
            </ul>
            {!neighbors.size && <p>No recorded connections in this view.</p>}
          </aside>
        )}
      </div>
      <div className="graph-footer">
        <div className="graph-legend">
          {Object.entries(labels).map(([key, label]) => (
            <span key={key}>
              <i style={{ background: colors[key as Relationship] }} />
              {label}
            </span>
          ))}
        </div>
        <p>Drag to explore · Scroll to zoom</p>
      </div>
    </section>
  );
}
function Canvas({
  initialNodes,
  edges,
  selected,
  neighbors,
  onSelect,
  onOpen,
}: {
  initialNodes: GraphNode[];
  edges: Edge[];
  selected: string | null;
  neighbors: Set<string>;
  onSelect: (id: string | null) => void;
  onOpen: (memory: Memory) => void;
}) {
  const [nodes, , onNodesChange] = useNodesState(initialNodes);
  const container = useRef<HTMLDivElement>(null);
  return (
    <div
      className="graph-flow"
      ref={container}
      onKeyDownCapture={(event) => {
        const id = (event.target as HTMLElement)
          .closest(".react-flow__node")
          ?.getAttribute("data-id");
        const node = nodes.find((node) => node.id === id);
        if (event.key === "Enter" && node) {
          event.preventDefault();
          event.stopPropagation();
          onOpen(node.data.memory);
        }
      }}
    >
      <ReactFlow<GraphNode>
        nodes={nodes.map((node) => ({
          ...node,
          selected: node.id === selected,
          style: {
            opacity:
              selected && node.id !== selected && !neighbors.has(node.id)
                ? 0.35
                : 1,
          },
        }))}
        edges={edges.map((edge) => ({
          ...edge,
          style: {
            ...edge.style,
            opacity:
              selected && edge.source !== selected && edge.target !== selected
                ? 0.18
                : 1,
          },
        }))}
        onNodesChange={onNodesChange}
        nodeTypes={nodeTypes}
        onNodeClick={(_, node) => onSelect(node.id)}
        onNodeDoubleClick={(_, node) => onOpen(node.data.memory)}
        onPaneClick={() => onSelect(null)}
        nodesConnectable={false}
        edgesFocusable={false}
        deleteKeyCode={null}
        ariaLabelConfig={{
          "node.a11yDescription.default":
            "Press Enter to read this note. Use Tab to visit another note or a zoom control.",
        }}
        fitView
        fitViewOptions={{ padding: 0.25, maxZoom: 1 }}
        minZoom={0.15}
        maxZoom={1.6}
        aria-label="Explore your notes"
        proOptions={{ hideAttribution: false }}
      >
        <Background color="#d7ddd2" gap={24} size={1} />
        <Controls showInteractive={false} />
        <FitOnResize container={container} />
      </ReactFlow>
    </div>
  );
}

function FitOnResize({
  container,
}: {
  container: RefObject<HTMLDivElement | null>;
}) {
  const { fitView } = useReactFlow();
  const initialized = useNodesInitialized();
  useEffect(() => {
    if (!container.current || !initialized) return;
    let frame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        void fitView({ padding: 0.25, maxZoom: 1 });
      });
    });
    observer.observe(container.current);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [container, fitView, initialized]);
  return null;
}
