"use client";
import { useState } from "react";
import { BriefPanel } from "./brief";
export function MemoryContext({
  projectId = null,
}: {
  projectId?: string | null;
}) {
  const [task, setTask] = useState("");
  const [taskId, setTaskId] = useState("");
  return (
    <>
      <div className="app-page-heading">
        <div>
          <p className="eyebrow">THE THREAD SO FAR</p>
          <h1>
            {projectId ? "Project context" : "Your context"}
            <span className="text-leaf">.</span>
          </h1>
          <p>Current memories, brought together with links to their sources.</p>
        </div>
      </div>
      <div className="max-w-3xl space-y-6">
        <BriefPanel projectId={projectId} />
        <form
          className="app-form app-panel"
          onSubmit={(e) => {
            e.preventDefault();
            setTaskId(task.trim());
          }}
        >
          <label>
            Task handoff ID
            <input
              maxLength={128}
              required
              value={task}
              onChange={(e) => setTask(e.target.value)}
              placeholder="The stable task ID saved with your handoff"
            />
          </label>
          <button className="app-button w-fit">Open task handoff</button>
        </form>
        {taskId && (
          <BriefPanel key={taskId} projectId={projectId} taskId={taskId} />
        )}
      </div>
    </>
  );
}
