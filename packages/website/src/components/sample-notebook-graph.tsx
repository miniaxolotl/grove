"use client";

import { useState } from "react";
import { Type } from "lucide-react";
import type { Memory, Notebook } from "@lib/shared/contracts";
import { memoryTitle } from "@/lib/memory-display";
import {
  MemoryGraphCanvas,
  layoutMemoryGraph,
} from "@/components/dashboard/memory-graph";
import "./sample-notebook-graph.css";

const notebooks: Notebook[] = [
  {
    id: "00000000-0000-4000-a000-000000000091",
    name: "Weekend projects",
    identity: "sample-weekend",
  },
  {
    id: "00000000-0000-4000-a000-000000000092",
    name: "Personal",
    identity: "sample-personal",
  },
];
const samples = [
  [
    "A tiny balcony garden",
    "Start with mint and rosemary in the sunny corner. Keep mint in its own pot. Two plants is enough to begin.",
    0,
  ],
  [
    "Fresh herbs for dinner",
    "Use the first mint leaves in a chickpea salad with lemon. Keep a few sprigs for tea.",
    0,
  ],
  [
    "Saturday's shopping list",
    "Two pots with drainage, peat-free compost and a small watering can. Check the pots we already have before buying more.",
    0,
  ],
  [
    "The sunny corner",
    "The balcony gets afternoon sun. Rosemary can go beside the railing; move the mint back during the hottest part of summer.",
    0,
  ],
  [
    "A slower Sunday",
    "Meet Maya at 10:30 by the boathouse. Take the lakeside path, then lunch at the cabin. Bring the camera.",
    1,
  ],
  [
    "What worked today",
    "A walk before opening email helped me find the opening for the essay. Try the same walk tomorrow.",
    1,
  ],
  [
    "The first issue",
    "A monthly newsletter: one useful idea, one photograph and five minutes to read. Draft the first issue by Friday.",
    1,
  ],
  [
    "A reading corner",
    "Move the armchair beside the west window. Use the lamp from the bedroom and keep the books I'm reading within reach.",
    0,
  ],
] as const;
const notes: Memory[] = samples.map(([title, text, notebook], index) => ({
  id: `00000000-0000-4000-a000-${String(index + 1).padStart(12, "0")}`,
  projectId: notebooks[notebook].id,
  content: `# ${title}\n\n${text}`,
  kind: "fact",
  status: "active",
  version: 1,
  source: { agent: "website" },
  taskId: null,
  expiresAt: null,
  purgeAt: null,
  createdAt: "2026-11-04T00:00:00Z",
  updatedAt: "2026-11-04T00:00:00Z",
  indexing: "ready",
}));
const pairs = [
  [0, 1],
  [0, 2],
  [0, 3],
  [1, 2],
  [2, 3],
  [4, 5],
  [5, 6],
  [6, 7],
];
const edges: Parameters<typeof MemoryGraphCanvas>[0]["edges"] = pairs.map(
  ([from, to], index) => ({
    id: `sample-connection-${index}`,
    source: notes[from].id,
    target: notes[to].id,
    type: "connection",
    data: { relationship: "complementary" },
    ariaLabel: `Related: ${memoryTitle(notes[from])} and ${memoryTitle(notes[to])}. Press Enter to inspect.`,
  }),
);
// The app's deterministic force layout runs once for these fixed local fixtures.
const graphNodes = layoutMemoryGraph(notes, notebooks, edges);

export default function SampleNotebookGraph() {
  const [selected, setSelected] = useState(notes[0].id);
  const [showTitles, setShowTitles] = useState(false);
  const note = notes.find((item) => item.id === selected) ?? notes[0];
  const linked = notes.filter((item) =>
    edges.some(
      (edge) =>
        (edge.source === selected && edge.target === item.id) ||
        (edge.target === selected && edge.source === item.id),
    ),
  );
  return (
    <section
      className="sample-graph memory-graph"
      aria-label="Sample linked notes graph"
    >
      <div className="graph-toolbar">
        <div className="graph-heading">
          <div>
            <strong>Connected ideas</strong>
            <span>
              {notes.length} sample notes · {edges.length} connections
            </span>
          </div>
        </div>
        <button
          type="button"
          className="graph-tool-button"
          aria-label="Show note titles"
          aria-pressed={showTitles}
          onClick={() => setShowTitles((value) => !value)}
        >
          <Type size={16} aria-hidden="true" /> Titles
        </button>
      </div>
      <div className="graph-layout has-selection">
        <div className="graph-canvas">
          <MemoryGraphCanvas
            initialNodes={graphNodes}
            edges={edges}
            selected={selected}
            showTitles={showTitles}
            expanded={false}
            onSelect={(id) => setSelected(id ?? notes[0].id)}
            onOpen={(item) => setSelected(item.id)}
            onConnection={(id) => {
              const edge = edges.find((item) => item.id === id);
              if (edge) setSelected(edge.target);
            }}
          />
        </div>
        <aside
          className="graph-inspector"
          aria-label="Selected sample note"
          aria-live="polite"
        >
          <div className="sample-note-pages">
            {notes.map((item) => (
              <div
                key={item.id}
                className="sample-note-page"
                data-inactive={item.id !== note.id}
                aria-hidden={item.id !== note.id}
                inert={item.id !== note.id}
              >
                <span className="graph-inspector-notebook">
                  {notebooks.find((book) => book.id === item.projectId)?.name}
                </span>
                <h3>{memoryTitle(item)}</h3>
                <p>{item.content.split("\n\n")[1]}</p>
              </div>
            ))}
          </div>
          <h4>Linked notes</h4>
          <ul className="sample-linked-notes">
            {linked.map((item) => (
              <li key={item.id}>
                <button type="button" onClick={() => setSelected(item.id)}>
                  {memoryTitle(item)}
                </button>
              </li>
            ))}
          </ul>
        </aside>
      </div>
      <p className="sample-graph-caption">
        The app’s graph renderer with local sample notes. Select a note, pan or
        use the zoom controls.
      </p>
    </section>
  );
}
