import { randomUUID } from "node:crypto";
import { policy } from "@lib/config";
import type { Knex } from "@lib/database";
import {
  GroveError,
  agentNames,
  type ConnectInput,
  type ConnectAttempt,
  type ConnectApproval,
  type Grant,
  type Principal,
} from "@lib/shared/contracts";
import type { MemoryService } from "./index.ts";

type Connection = Omit<Grant, "expiresAt"> & {
  id: string;
  clientId: string | null;
  revokedAt: Date | null;
  expiresAt: Date | null;
  setup: ConnectAttempt | null;
};
const unavailable = () =>
  new GroveError(
    "connection_unavailable",
    "This connection link is unavailable. Run grove connect again, using the same Grove account in your browser.",
    404,
  );
const active = (connection: Connection) => {
  if (
    connection.revokedAt ||
    (connection.expiresAt &&
      new Date(connection.expiresAt).getTime() <= Date.now())
  )
    throw new GroveError(
      "connection_revoked",
      "This connection was revoked or expired. Run grove connect again.",
      403,
    );
};
function view(connection: Connection): ConnectAttempt {
  active(connection);
  const attempt = connection.setup!;
  return {
    ...attempt,
    status:
      attempt.status === "pending" &&
      Date.parse(attempt.expiresAt) <= Date.now()
        ? "expired"
        : attempt.status,
  };
}

/** Identity comes from OAuth; only the matching website account can approve access. */
export class ConnectionSetup {
  constructor(private memories: MemoryService) {}

  async start(
    principal: Principal,
    input: ConnectInput,
  ): Promise<ConnectAttempt> {
    if (principal.type === "session")
      throw new GroveError(
        "agent_required",
        "Start this connection from your agent's terminal",
        403,
      );
    return this.memories.access(principal, "self", async ({ trx, grant }) => {
      const connection = await trx<Connection>("connections")
        .where({ id: grant!.id })
        .forUpdate()
        .first();
      if (!connection) throw unavailable();
      active(connection);
      const project = input.project
        ? await trx("projects")
            .where({ identity: input.project.identity })
            .first()
        : null;
      const hasAccess =
        connection.capabilities.length > 0 &&
        (input.project
          ? project &&
            (connection.allProjects ||
              connection.projectIds.includes(project.id))
          : connection.personal);
      const previous = connection.setup;
      if (
        previous &&
        previous.agent === input.agent &&
        previous.project?.identity === input.project?.identity &&
        ["pending", "approved"].includes(view(connection).status)
      )
        return view(connection);
      if (!hasAccess && principal.type !== "oauth")
        throw new GroveError(
          "connection_scope",
          "This API key does not cover this project. Edit its scope in Grove Connections, then retry.",
          403,
        );
      const attempt: ConnectAttempt = {
        ...input,
        id: randomUUID(),
        connectionId: connection.id,
        clientId: connection.clientId,
        status: hasAccess ? "approved" : "pending",
        expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
        projectId: hasAccess && project ? project.id : null,
        grant: connection.capabilities.length
          ? {
              name: connection.name,
              capabilities: connection.capabilities,
              personal: connection.personal,
              allProjects: connection.allProjects,
              projectIds: connection.projectIds,
              ...(connection.expiresAt
                ? { expiresAt: new Date(connection.expiresAt).toISOString() }
                : {}),
            }
          : {
              name: `${agentNames[input.agent]}${input.project ? ` · ${input.project.name}` : ""}`.slice(
                0,
                100,
              ),
              capabilities: ["memory:read", "memory:write"],
              personal: true,
              allProjects: false,
              projectIds: [],
            },
      };
      await trx("connections")
        .where({ id: connection.id })
        .update({ setup: JSON.stringify(attempt) });
      return attempt;
    });
  }

  private async find(
    trx: Knex.Transaction,
    principal: Principal,
    id: string,
    lock = false,
  ) {
    const query = trx<Connection>("connections").whereRaw("setup->>'id' = ?", [
      id,
    ]);
    if (principal.type !== "session")
      query.where({ id: principal.connectionId });
    const connection = await (lock ? query.forUpdate() : query).first();
    if (!connection?.setup) throw unavailable();
    active(connection);
    return connection;
  }

  async get(principal: Principal, id: string) {
    return this.memories.access(principal, null, async ({ trx }) =>
      view(await this.find(trx, principal, id)),
    );
  }

  async approve(principal: Principal, id: string, input: ConnectApproval) {
    return this.memories.access(
      principal,
      "admin",
      async ({ trx, account }) => {
        const connection = await this.find(trx, principal, id, true);
        const attempt = view(connection);
        // A repeated callback never reapplies old permissions.
        if (attempt.status === "approved") return attempt;
        if (attempt.status !== "pending")
          throw new GroveError(
            "connection_expired",
            "This connection request has ended. Run grove connect again.",
            410,
          );
        if (input.expiresAt && Date.parse(input.expiresAt) <= Date.now())
          throw new GroveError(
            "invalid_request",
            "Expiry must be in the future",
          );
        const projectIds = new Set(input.projectIds);
        for (const projectId of projectIds)
          if (!(await trx("projects").where({ id: projectId }).first()))
            throw new GroveError("not_found", "Project not found", 404);
        let projectId: string | null = null;
        if (attempt.project && (input.currentProject || input.allProjects)) {
          let project = await trx("projects")
            .where({ identity: attempt.project.identity })
            .first();
          if (!project) {
            const total = await trx("projects").count("id as count").first();
            if (Number(total?.count) >= policy.maxProjects)
              throw new GroveError(
                "project_limit",
                "Project limit reached",
                429,
              );
            [project] = await trx("projects")
              .insert({ ...attempt.project, accountId: account.id })
              .returning("*");
          }
          projectId = project.id;
          projectIds.add(project.id);
        }
        if (!input.personal && !input.allProjects && !projectIds.size)
          throw new GroveError(
            "invalid_request",
            "Choose personal memories or a project",
          );
        const { currentProject: _currentProject, ...grant } = input;
        const approved: ConnectAttempt = {
          ...attempt,
          status: "approved",
          projectId,
          grant: { ...grant, projectIds: [...projectIds] },
        };
        await trx("connections")
          .where({ id: connection.id })
          .update({
            ...approved.grant,
            expiresAt: input.expiresAt ?? null,
            setup: JSON.stringify(approved),
          });
        return approved;
      },
    );
  }

  async cancel(principal: Principal, id: string) {
    return this.memories.access(
      principal,
      principal.type === "session" ? "admin" : "self",
      async ({ trx }) => {
        const connection = await this.find(trx, principal, id, true);
        const attempt = view(connection);
        if (attempt.status === "pending") {
          attempt.status = "cancelled";
          await trx("connections")
            .where({ id: connection.id })
            .update({ setup: JSON.stringify(attempt) });
        }
        return attempt;
      },
    );
  }
}
