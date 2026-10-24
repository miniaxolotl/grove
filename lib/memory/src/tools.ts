import { GroveError, type Principal } from "@lib/shared/contracts";
import { memoryTools } from "@lib/shared/memory-tools";
import { notebookLifecycleSchema } from "@lib/shared/notebook-lifecycle";
import type { MemoryService } from "./index.ts";

export async function executeMemoryTool(
  service: MemoryService,
  principal: Principal,
  tool: string,
  value: unknown,
  signal?: AbortSignal,
): Promise<unknown> {
  switch (tool) {
    case "remember":
      return service.remember(
        principal,
        memoryTools.remember.schema.parse(value),
      );
    case "recall":
      return service.recall(
        principal,
        memoryTools.recall.schema.parse(value),
        signal,
      );
    case "memories":
      return service.list(principal, memoryTools.memories.schema.parse(value));
    case "forget":
      return service.forget(principal, memoryTools.forget.schema.parse(value));
    case "get_memory": {
      const input = memoryTools.get_memory.schema.parse(value);
      return input.revision
        ? service.sourceRevision(principal, input.id, input.revision)
        : service.get(principal, input.id);
    }
    case "memory_history":
      return service.revisions(
        principal,
        memoryTools.memory_history.schema.parse(value).id,
      );
    case "update_memory":
      return service.updateMemory(
        principal,
        memoryTools.update_memory.schema.parse(value),
      );
    case "move_memories":
      return service.moveMemories(
        principal,
        memoryTools.move_memories.schema.parse(value),
      );
    case "archive_memory":
    case "restore_memory": {
      const { id, ...input } = memoryTools[tool].schema.parse(value);
      return service.lifecycle(
        principal,
        id,
        tool === "archive_memory" ? "archive" : "restore",
        input,
      );
    }
    case "notebooks":
      return service.listNotebooks(
        principal,
        memoryTools.notebooks.schema.parse(value),
      );
    case "create_notebook":
      return service.createNotebook(principal, value);
    case "update_notebook":
      return service.updateNotebook(principal, value);
    case "notebook_lifecycle": {
      const { id, action, ...input } =
        memoryTools.notebook_lifecycle.schema.parse(value);
      return action === "preview"
        ? service.previewProjectLifecycle(principal, id)
        : service.projectLifecycle(
            principal,
            id,
            action,
            notebookLifecycleSchema.parse(input),
          );
    }
    default:
      throw new GroveError("not_found", "Unknown Grove tool", 404);
  }
}
