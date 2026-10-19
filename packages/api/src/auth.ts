import { createClerkClient } from "@clerk/backend";
import { TokenVerificationError } from "@clerk/backend/errors";
import { createRemoteJWKSet, decodeJwt, jwtVerify, errors } from "jose";
import { tenant, camelRows, type Knex } from "@lib/database";
import { digest, sessionPrincipal } from "@lib/memory";
import {
  capabilities,
  GroveError,
  type Principal,
} from "@lib/shared/contracts";
import type { ServerEnvironment } from "@lib/environment";

export interface Identity {
  subject: string;
  type: "session" | "oauth";
  sessionId?: string;
  clientId?: string;
  issuedAt?: number;
  scopes?: string[];
}
export interface TokenVerifier {
  verify(token: string): Promise<Identity>;
}
const unauthorized = () =>
  new GroveError("unauthorized", "Sign in to Grove", 401);

/** Fixed-issuer verification; neither token claims nor request hosts select the JWKS URL. */
export function clerkVerifier(env: ServerEnvironment): TokenVerifier {
  const jwks = createRemoteJWKSet(
    new URL("/.well-known/jwks.json", env.CLERK_ISSUER),
    { timeoutDuration: 5000 },
  );
  const clerk = createClerkClient({
    secretKey: env.CLERK_SECRET_KEY,
    publishableKey: env.CLERK_PUBLISHABLE_KEY,
  });
  return {
    async verify(token) {
      let isSession = false;
      try {
        isSession = typeof decodeJwt(token).sid === "string";
      } catch {
        /* opaque OAuth tokens */
      }
      try {
        if (isSession) {
          const { payload } = await jwtVerify(token, jwks, {
            issuer: env.CLERK_ISSUER,
            algorithms: ["RS256"],
            clockTolerance: 5,
            requiredClaims: ["sub", "exp", "iat", "sid", "azp"],
          });
          if (
            payload.azp !== env.SITE_URL ||
            payload.sts === "pending" ||
            payload.client_id ||
            typeof payload.sid !== "string" ||
            !payload.sub?.startsWith("user_") ||
            typeof payload.iat !== "number" ||
            payload.iat > Date.now() / 1000 + 5
          )
            throw unauthorized();
          return {
            subject: payload.sub,
            type: "session",
            sessionId: payload.sid,
          };
        }
        const access = await clerk.idPOAuthAccessToken.verify(token, {
          audience: `${env.API_ORIGIN}/mcp`,
        });
        // Clerk's opaque-token verification response omits `type` despite the SDK declaration.
        // The OAuth-only verification endpoint, user subject and client identity establish its class.
        if (
          (access.type && access.type !== "oauth_token") ||
          access.revoked ||
          access.expired ||
          !access.subject.startsWith("user_") ||
          !access.clientId ||
          !access.aud?.includes(`${env.API_ORIGIN}/mcp`) ||
          !access.scopes.includes("openid")
        )
          throw unauthorized();
        // Backend API date fields use Unix seconds; JWT resource conversion uses milliseconds.
        const issuedAt =
          access.createdAt < 1e12 ? access.createdAt * 1000 : access.createdAt;
        if (
          !Number.isFinite(issuedAt) ||
          issuedAt <= 0 ||
          issuedAt > Date.now() + 5000
        )
          throw unauthorized();
        return {
          subject: access.subject,
          type: "oauth",
          clientId: access.clientId,
          issuedAt,
          scopes: access.scopes,
        };
      } catch (error) {
        if (error instanceof GroveError) throw error;
        const status = (error as { status?: number }).status;
        if (
          error instanceof TokenVerificationError ||
          (error instanceof errors.JOSEError &&
            !(error instanceof errors.JWKSTimeout)) ||
          (status && status >= 400 && status < 500 && status !== 429)
        )
          throw unauthorized();
        throw new GroveError(
          "auth_unavailable",
          "Authentication is temporarily unavailable",
          503,
        );
      }
    },
  };
}

export class Authentication {
  constructor(
    private db: Knex,
    private verifier: TokenVerifier,
  ) {}
  async principal(request: Request): Promise<Principal> {
    const token = request.headers
      .get("authorization")
      ?.match(/^Bearer (\S+)$/i)?.[1];
    if (!token || token.length > 16384) throw unauthorized();
    if (token.startsWith("grv_")) {
      const match = token.match(
        /^grv_([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})_[A-Za-z0-9_-]{43}$/,
      );
      if (!match) throw unauthorized();
      const row = camelRows<{
        accountId: string;
        connectionId: string;
        clerkSubject: string;
      }>(
        await this.db.raw("SELECT * FROM grove_key(?::uuid, ?)", [
          match[1],
          digest(token),
        ]),
      )[0];
      if (!row) throw unauthorized();
      return {
        accountId: row.accountId,
        subject: row.clerkSubject,
        type: "key",
        connectionId: row.connectionId,
        capabilities: [...capabilities],
      };
    }
    const identity = await this.verifier.verify(token);
    const { rows } = await this.db.raw("SELECT * FROM grove_account(?)", [
      identity.subject,
    ]);
    const account = rows[0];
    if (!account || account.status !== "active")
      throw new GroveError(
        "account_unavailable",
        "This account is unavailable",
        403,
      );
    if (identity.type === "session")
      return {
        ...sessionPrincipal(account.id, identity.subject),
        sessionId: identity.sessionId,
      };
    if (
      !identity.clientId ||
      !Number.isFinite(identity.issuedAt) ||
      !identity.scopes?.includes("openid")
    )
      throw unauthorized();
    const connection = await tenant(this.db, account.id, async (trx) => {
      await trx("connections")
        .insert({
          accountId: account.id,
          clientId: identity.clientId,
          name: "Awaiting approval",
          capabilities: [],
          authorizedAfter: new Date(0),
        })
        .onConflict(["accountId", "clientId"])
        .ignore();
      const row = await trx("connections")
        .where({ clientId: identity.clientId })
        .first();
      if (
        !row ||
        row.revokedAt ||
        identity.issuedAt! < new Date(row.authorizedAfter).getTime()
      )
        throw new GroveError(
          "connection_revoked",
          "Reconnect and approve this client in Grove Connections",
          403,
        );
      if (row.expiresAt && new Date(row.expiresAt).getTime() <= Date.now())
        throw unauthorized();
      await trx("connections")
        .where({ id: row.id })
        .update({ lastUsedAt: trx.fn.now() });
      return row;
    });
    return {
      accountId: account.id,
      subject: identity.subject,
      type: "oauth",
      connectionId: connection.id,
      clientId: identity.clientId,
      issuedAt: identity.issuedAt,
      capabilities: [...capabilities],
    };
  }
}
