"use client";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type RefObject,
} from "react";
import {
  ReactFlow,
  Background,
  Controls,
  BaseEdge,
  Handle,
  Position,
  useNodesState,
  useNodesInitialized,
  useReactFlow,
  useStore,
  type Node,
  type NodeProps,
  type Edge,
  type EdgeProps,
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
import {
  ArrowUpRight,
  Maximize2,
  Minimize2,
  Network,
  Type,
  X,
} from "lucide-react";
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
  complementary: "#8cccb4",
  duplicate: "#b6a0e9",
  conflicting: "#e6b17e",
};
const notebookColors = [
  "#a8d99c",
  "#89c9e3",
  "#bcacf0",
  "#e4bd87",
  "#e4a7ba",
  "#80d5c5",
];
function notebookColor(id: string | null) {
  if (!id) return notebookColors[0];
  const hash = [...id].reduce(
    (value, letter) => (value * 31 + letter.charCodeAt(0)) >>> 0,
    0,
  );
  return notebookColors[1 + (hash % (notebookColors.length - 1))];
}
type GraphNode = Node<
  {
    memory: Memory;
    project: string;
    color: string;
    degree: number;
    showTitles?: boolean;
    sparse?: boolean;
    emphasized?: boolean;
    neighbor?: boolean;
  },
  "memory"
>;
type ConnectionEdge = Edge<
  {
    relationship: Relationship;
    emphasized?: boolean;
    dimmed?: boolean;
  },
  "connection"
>;

function MemoryNode({ data }: NodeProps<GraphNode>) {
  const zoom = useStore((state) => state.transform[2]);
  const titleVisible =
    data.emphasized ||
    (data.showTitles && (zoom >= 0.85 || data.degree >= 4 || data.sparse));
  return (
    <div
      className={`graph-memory-node${titleVisible ? " has-title" : ""}${data.emphasized ? " is-emphasized" : ""}${data.neighbor ? " is-neighbor" : ""}${data.degree >= 4 ? " is-hub" : ""}${!data.degree ? " is-unlinked" : ""}`}
      style={
        {
          "--graph-node-color": data.color,
          "--graph-node-size": `${14 + Math.min(data.degree, 10) * 1.6}px`,
          "--graph-detail-scale": 1 / zoom,
        } as CSSProperties
      }
    >
      <Handle type="target" position={Position.Top} />
      <span className="graph-node-orbit" aria-hidden="true">
        <span className={`graph-node-core kind-${data.memory.kind}`} />
      </span>
      <span className="graph-node-label" aria-hidden="true">
        <strong title={memoryTitle(data.memory)}>
          {memoryTitle(data.memory)}
        </strong>
        <span>
          {noteKindLabel(data.memory.kind)} · {data.degree}{" "}
          {data.degree === 1 ? "link" : "links"}
        </span>
      </span>
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}
const nodeTypes = { memory: MemoryNode };

function MemoryConnection({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  data,
}: EdgeProps<ConnectionEdge>) {
  const relationship = data?.relationship ?? "complementary";
  const dx = targetX - sourceX;
  const dy = targetY - sourceY;
  const distance = Math.hypot(dx, dy) || 1;
  const curve =
    Math.min(distance * 0.12, 32) * (relationship === "duplicate" ? -1 : 1);
  const path = `M ${sourceX},${sourceY} Q ${(sourceX + targetX) / 2 - (dy / distance) * curve},${(sourceY + targetY) / 2 + (dx / distance) * curve} ${targetX},${targetY}`;
  return (
    <g
      className={`graph-connection relationship-${relationship}${data?.emphasized ? " is-emphasized" : ""}${data?.dimmed ? " is-dimmed" : ""}`}
      style={{ "--graph-edge-color": colors[relationship] } as CSSProperties}
    >
      <path className="graph-connection-glow" d={path} aria-hidden="true" />
      <BaseEdge
        id={id}
        path={path}
        className="graph-connection-line"
        interactionWidth={0}
      />
      {data?.emphasized && (
        <path className="graph-connection-spark" d={path} aria-hidden="true" />
      )}
    </g>
  );
}
const edgeTypes = { connection: MemoryConnection };

function graphEdges(items: Memory[]): ConnectionEdge[] {
  const edges = new Map<string, ConnectionEdge>();
  const byId = new Map(items.map((item) => [item.id, item]));
  for (const memory of items)
    for (const relation of memory.enrichment?.relationships ?? []) {
      const other = byId.get(relation.id);
      if (
        relation.relationship === "unrelated" ||
        relation.id === memory.id ||
        !other ||
        other.version !== relation.version ||
        other.projectId !== memory.projectId
      )
        continue;
      const [source, target] = [memory.id, relation.id].sort();
      const id = `${source}:${target}:${relation.relationship}`;
      edges.set(id, {
        id,
        source,
        target,
        type: "connection",
        data: { relationship: relation.relationship },
        ariaLabel: `${labels[relation.relationship]}: ${memoryTitle(memory)} and ${memoryTitle(other)}`,
      });
    }
  return [...edges.values()];
}
function layout(
  items: Memory[],
  projects: Project[],
  edges: ConnectionEdge[],
): GraphNode[] {
  const scopes = [...new Set(items.map((item) => item.projectId))].sort();
  const ordered = [...items].sort((a, b) => a.id.localeCompare(b.id));
  const degree = new Map(items.map((item) => [item.id, new Set<string>()]));
  for (const edge of edges) {
    degree.get(edge.source)!.add(edge.target);
    degree.get(edge.target)!.add(edge.source);
  }
  const groupRadius =
    scopes.length > 1 ? 100 + Math.sqrt(items.length / scopes.length) * 45 : 0;
  const particles: (SimulationNodeDatum & { id: string; group: number })[] =
    ordered.map((item) => ({
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
        .distance(180)
        .strength(0.35),
    )
    .force("charge", forceManyBody().strength(-600))
    .force("collide", forceCollide(90).iterations(3))
    .force(
      "x",
      forceX<(typeof particles)[number]>(
        (node) =>
          Math.cos((node.group / scopes.length) * Math.PI * 2) * groupRadius,
      ).strength(0.08),
    )
    .force(
      "y",
      forceY<(typeof particles)[number]>(
        (node) =>
          Math.sin((node.group / scopes.length) * Math.PI * 2) * groupRadius,
      ).strength(0.08),
    );
  simulation.tick(220);
  return ordered.map((memory, index) => ({
    id: memory.id,
    type: "memory",
    position: { x: particles[index].x! - 80, y: particles[index].y! - 28 },
    data: {
      memory,
      project:
        projects.find((project) => project.id === memory.projectId)?.name ??
        "Personal",
      color: notebookColor(memory.projectId),
      degree: degree.get(memory.id)!.size,
    },
    ariaLabel: `${memoryTitle(memory)}. ${noteKindLabel(memory.kind)}. ${degree.get(memory.id)!.size} linked notes. Press Enter to read or Space to explore connections.`,
    width: 160,
    height: 104,
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
  const [showTitles, setShowTitles] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [canExpand, setCanExpand] = useState(false);
  const [fullscreenError, setFullscreenError] = useState("");
  const section = useRef<HTMLElement>(null);
  useEffect(() => {
    const element = section.current;
    setCanExpand(
      Boolean(document.fullscreenEnabled && element?.requestFullscreen),
    );
    const changed = () => setExpanded(document.fullscreenElement === element);
    document.addEventListener("fullscreenchange", changed);
    return () => document.removeEventListener("fullscreenchange", changed);
  }, []);
  async function toggleFullscreen() {
    setFullscreenError("");
    try {
      if (document.fullscreenElement === section.current)
        await document.exitFullscreen();
      else await section.current?.requestFullscreen();
    } catch {
      setFullscreenError(
        "Full screen couldn't open. You can still explore the graph here.",
      );
    }
  }
  const edges = useMemo(() => graphEdges(items), [items]);
  const visibleEdges = useMemo(
    () =>
      relationship
        ? edges.filter((edge) => edge.data?.relationship === relationship)
        : edges,
    [edges, relationship],
  );
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
  const notebooks = [
    ...new Set(visibleItems.map((item) => item.projectId)),
  ].map((id) => ({
    id,
    name: projects.find((project) => project.id === id)?.name ?? "Personal",
    count: visibleItems.filter((item) => item.projectId === id).length,
    color: notebookColor(id),
  }));
  return (
    <section
      className="memory-graph"
      aria-label="Linked notes graph"
      ref={section}
    >
      <div className="graph-toolbar">
        <div className="graph-heading">
          <span className="graph-heading-icon">
            <Network size={18} />
          </span>
          <div>
            <strong>Connected ideas</strong>
            <span>
              {visibleItems.length} notes · {visibleEdges.length}{" "}
              {visibleEdges.length === 1 ? "connection" : "connections"}
            </span>
          </div>
        </div>
        <div className="graph-tools">
          <label>
            <span className="sr-only">Show</span>
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
          <button
            type="button"
            className="graph-tool-button"
            aria-label="Show note titles"
            aria-pressed={showTitles}
            title="Show note titles"
            onClick={() => setShowTitles(!showTitles)}
          >
            <Type size={16} />
            <span>Titles</span>
          </button>
          <button
            type="button"
            className="graph-tool-button graph-expand"
            aria-label={expanded ? "Exit full screen" : "Expand graph"}
            title={
              canExpand
                ? expanded
                  ? "Exit full screen"
                  : "Expand graph"
                : "Full screen is unavailable in this browser"
            }
            disabled={!canExpand}
            onClick={() => void toggleFullscreen()}
          >
            {expanded ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
          </button>
        </div>
      </div>
      <div className={`graph-layout${active ? " has-selection" : ""}`}>
        <div className="graph-canvas">
          <Canvas
            key={`${items.map((item) => `${item.id}:${item.version}`).join()}:${relationship}:${visibleEdges.map((edge) => edge.id).join()}`}
            initialNodes={initialNodes.filter((node) =>
              visibleItems.some((item) => item.id === node.id),
            )}
            edges={visibleEdges}
            selected={selected}
            showTitles={showTitles}
            onSelect={setSelected}
            onOpen={onOpen}
          />
          {!visibleEdges.length && (
            <p className="graph-hint" role="status">
              {relationship
                ? "No matching connections here."
                : "Connections appear as Grove finds related ideas."}
            </p>
          )}
        </div>
        {active && (
          <aside className="graph-inspector" aria-label="Selected note">
            <div className="graph-inspector-heading">
              <span>
                <i style={{ background: notebookColor(active.projectId) }} />
                {noteKindLabel(active.kind)}
              </span>
              <button
                className="app-icon"
                aria-label="Clear graph selection"
                onClick={() => setSelected(null)}
              >
                <X size={16} />
              </button>
            </div>
            <h3>{memoryTitle(active)}</h3>
            <span className="graph-inspector-notebook">
              {projects.find((project) => project.id === active.projectId)
                ?.name ?? "Personal"}
            </span>
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
      {notebooks.length > 0 && (
        <div className="graph-notebooks" aria-label="Notebook colors">
          {notebooks.map((notebook) => (
            <span key={notebook.id ?? "personal"} title={notebook.name}>
              <i style={{ background: notebook.color }} />
              <span>{notebook.name}</span>
              <small>{notebook.count}</small>
            </span>
          ))}
          <p>More links, a brighter star.</p>
        </div>
      )}
      <div className="graph-footer">
        <div className="graph-legend">
          {Object.entries(labels).map(([key, label]) => (
            <span key={key}>
              <i
                className={`relationship-${key}`}
                style={{ borderColor: colors[key as Relationship] }}
              />
              {label}
            </span>
          ))}
        </div>
        <p className="graph-help-pointer">
          Drag to explore · Hover to trace · Click to read more
        </p>
        <p className="graph-help-touch">
          Drag to explore · Pinch to zoom · Tap a note
        </p>
      </div>
      {fullscreenError && (
        <p className="graph-notice" role="status">
          {fullscreenError}
        </p>
      )}
    </section>
  );
}
function Canvas({
  initialNodes,
  edges,
  selected,
  showTitles,
  onSelect,
  onOpen,
}: {
  initialNodes: GraphNode[];
  edges: ConnectionEdge[];
  selected: string | null;
  showTitles: boolean;
  onSelect: (id: string | null) => void;
  onOpen: (memory: Memory) => void;
}) {
  const [nodes, , onNodesChange] = useNodesState(initialNodes);
  const [hovered, setHovered] = useState<string | null>(null);
  const container = useRef<HTMLDivElement>(null);
  const focused = hovered ?? selected;
  const currentNodes = new Map(initialNodes.map((node) => [node.id, node]));
  const neighbors = new Set(
    edges
      .filter((edge) => edge.source === focused || edge.target === focused)
      .flatMap((edge) => [edge.source, edge.target]),
  );
  return (
    <div
      className="graph-flow"
      ref={container}
      onFocusCapture={(event) =>
        setHovered(
          (event.target as HTMLElement)
            .closest(".react-flow__node")
            ?.getAttribute("data-id") ?? null,
        )
      }
      onBlurCapture={() => setHovered(null)}
      onKeyDownCapture={(event) => {
        const id = (event.target as HTMLElement)
          .closest(".react-flow__node")
          ?.getAttribute("data-id");
        const node = id ? currentNodes.get(id) : undefined;
        if (event.key === "Enter" && node) {
          event.preventDefault();
          event.stopPropagation();
          onOpen(node.data.memory);
        }
        if (event.key === " " && node) {
          event.preventDefault();
          event.stopPropagation();
          onSelect(node.id);
        }
        if (event.key === "Escape" && selected) {
          onSelect(null);
          setHovered(null);
        }
      }}
    >
      <ReactFlow<GraphNode, ConnectionEdge>
        nodes={nodes.map((node) => ({
          ...node,
          ariaLabel: currentNodes.get(node.id)?.ariaLabel ?? node.ariaLabel,
          selected: node.id === selected,
          data: {
            ...(currentNodes.get(node.id)?.data ?? node.data),
            showTitles,
            sparse: nodes.length <= 12,
            emphasized: node.id === focused,
            neighbor: neighbors.has(node.id),
          },
          style: {
            opacity:
              focused && node.id !== focused && !neighbors.has(node.id)
                ? 0.2
                : 1,
          },
        }))}
        edges={edges.map((edge) => ({
          ...edge,
          data: {
            ...edge.data!,
            emphasized: edge.source === focused || edge.target === focused,
            dimmed: Boolean(
              focused && edge.source !== focused && edge.target !== focused,
            ),
          },
        }))}
        onNodesChange={onNodesChange}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodeMouseEnter={(_, node) => setHovered(node.id)}
        onNodeMouseLeave={() => setHovered(null)}
        onNodeDragStart={() => setHovered(null)}
        onNodeClick={(_, node) => onSelect(node.id)}
        onNodeDoubleClick={(_, node) => onOpen(node.data.memory)}
        onPaneClick={() => {
          onSelect(null);
          setHovered(null);
        }}
        nodesConnectable={false}
        edgesFocusable={false}
        deleteKeyCode={null}
        ariaLabelConfig={{
          "node.a11yDescription.default":
            "Press Enter to read this note, or Space to explore its connections. Use Tab to visit another note or a zoom control.",
        }}
        fitView
        fitViewOptions={{ padding: 0.18, maxZoom: 1.15 }}
        minZoom={0.15}
        maxZoom={2}
        aria-label="Explore your notes"
        proOptions={{ hideAttribution: false }}
      >
        <Background color="#718c8555" gap={28} size={0.8} />
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
        void fitView({ padding: 0.18, maxZoom: 1.15 });
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
