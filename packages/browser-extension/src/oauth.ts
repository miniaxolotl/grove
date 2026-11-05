import {
  auth,
  type OAuthClientProvider,
} from "@modelcontextprotocol/sdk/client/auth.js";
import {
  OAuthClientInformationSchema,
  OAuthTokensSchema,
  type OAuthClientInformationMixed,
  type OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";

export interface Store {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
  remove(key: string): Promise<void>;
}
export interface BrowserIdentity {
  getRedirectURL(): string;
  launchWebAuthFlow(options: {
    url: string;
    interactive: boolean;
  }): Promise<string | undefined>;
}
export function authorizationCode(
  callback: string,
  expected: string,
  state: string,
  issuer: string,
): string {
  const url = new URL(callback),
    redirect = new URL(expected);
  if (
    url.origin !== redirect.origin ||
    url.pathname !== redirect.pathname ||
    url.hash ||
    url.searchParams.getAll("state").length !== 1 ||
    url.searchParams.get("state") !== state ||
    url.searchParams.has("error") ||
    (url.searchParams.has("iss") && url.searchParams.get("iss") !== issuer) ||
    url.searchParams.getAll("code").length !== 1 ||
    !url.searchParams.get("code")
  )
    throw new Error("Sign-in callback could not be verified. Sign in again.");
  return url.searchParams.get("code")!;
}

/** Tokens/verifier live only in trusted session storage. Local storage holds a public client ID. */
export class BrowserOAuth implements OAuthClientProvider {
  readonly redirectUrl: string;
  private interactive = false;
  private code?: string;
  private renewing?: Promise<string>;
  private readonly key: string;
  constructor(
    readonly config: { apiOrigin: string; issuer: string },
    private local: Store,
    private session: Store,
    private identity: BrowserIdentity,
  ) {
    this.redirectUrl = identity.getRedirectURL();
    this.key = `oauth:${config.apiOrigin}|${config.issuer}|${this.redirectUrl}`;
  }
  get clientMetadata() {
    return {
      client_name: "Grove browser extension",
      redirect_uris: [this.redirectUrl],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      scope: "openid offline_access",
    };
  }
  async clientInformation() {
    const value = await this.local.get(this.key);
    return value ? OAuthClientInformationSchema.parse(value) : undefined;
  }
  async saveClientInformation(client: OAuthClientInformationMixed) {
    if (client.client_secret)
      throw new Error("Extension requires a public OAuth client");
    await this.local.set(this.key, {
      client_id: client.client_id,
      issuer: client.issuer,
    });
  }
  async tokens() {
    const value = await this.session.get(`${this.key}:tokens`);
    return value ? OAuthTokensSchema.parse(value) : undefined;
  }
  async saveTokens(tokens: OAuthTokens) {
    await this.session.set(
      `${this.key}:tokens`,
      OAuthTokensSchema.parse(tokens),
    );
    await this.session.set(
      `${this.key}:expires`,
      Date.now() + (tokens.expires_in ?? 300) * 1000,
    );
  }
  async state() {
    const state = crypto.randomUUID();
    await this.session.set(`${this.key}:state`, {
      state,
      expires: Date.now() + 600_000,
    });
    return state;
  }
  async saveCodeVerifier(verifier: string) {
    await this.session.set(`${this.key}:verifier`, verifier);
  }
  async codeVerifier() {
    const verifier = await this.session.get(`${this.key}:verifier`);
    if (typeof verifier !== "string")
      throw new Error("Sign-in expired. Sign in again.");
    return verifier;
  }
  async redirectToAuthorization(url: URL) {
    if (!this.interactive || url.origin !== new URL(this.config.issuer).origin)
      throw new Error("Sign in to reconnect Grove");
    const attempt = (await this.session.get(`${this.key}:state`)) as
      | { state: string; expires: number }
      | undefined;
    if (!attempt || attempt.expires <= Date.now())
      throw new Error("Sign-in expired. Sign in again.");
    const callback = await this.identity.launchWebAuthFlow({
      url: url.href,
      interactive: true,
    });
    if (!callback) throw new Error("Sign-in was cancelled");
    if (attempt.expires <= Date.now())
      throw new Error("Sign-in expired. Sign in again.");
    this.code = authorizationCode(
      callback,
      this.redirectUrl,
      attempt.state,
      this.config.issuer,
    );
  }
  async invalidateCredentials(
    scope: "all" | "client" | "tokens" | "verifier" | "discovery",
  ) {
    if (scope === "all" || scope === "client")
      await this.local.remove(this.key);
    if (scope === "all" || scope === "tokens") {
      await this.session.remove(`${this.key}:tokens`);
      await this.session.remove(`${this.key}:expires`);
    }
    if (scope === "all" || scope === "verifier") {
      await this.session.remove(`${this.key}:verifier`);
      await this.session.remove(`${this.key}:state`);
    }
  }
  private async authorize(interactive: boolean) {
    this.interactive = interactive;
    const fetchFn: typeof fetch = (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (
        ![this.config.apiOrigin, new URL(this.config.issuer).origin].includes(
          url.origin,
        )
      )
        throw new Error("OAuth endpoint is outside the configured Grove hosts");
      return fetch(input, {
        ...init,
        cache: "no-store",
        credentials: "omit",
        redirect: "error",
        signal: AbortSignal.any([
          AbortSignal.timeout(15000),
          ...(init?.signal ? [init.signal] : []),
        ]),
      });
    };
    try {
      const options = { serverUrl: `${this.config.apiOrigin}/mcp`, fetchFn };
      if ((await auth(this, options)) === "REDIRECT") {
        if (!this.code) throw new Error("Sign-in did not complete");
        await auth(this, { ...options, authorizationCode: this.code });
      }
      const tokens = await this.tokens();
      if (!tokens?.access_token) throw new Error("Sign in to reconnect Grove");
      return tokens.access_token;
    } catch (cause) {
      // Never blindly repeat an uncertain refresh/code exchange with an old token.
      await this.invalidateCredentials("tokens");
      throw new Error(
        "Sign-in could not be completed. Retry sign-in; check the configured OAuth client and hosts if it persists.",
        { cause },
      );
    } finally {
      this.interactive = false;
      this.code = undefined;
      await this.invalidateCredentials("verifier");
    }
  }
  async signIn() {
    if (!this.renewing)
      this.renewing = this.authorize(true).finally(() => {
        this.renewing = undefined;
      });
    return this.renewing;
  }
  async bearer() {
    const tokens = await this.tokens(),
      expires = await this.session.get(`${this.key}:expires`);
    if (
      tokens?.access_token &&
      typeof expires === "number" &&
      expires > Date.now() + 30000
    )
      return tokens.access_token;
    if (!tokens?.refresh_token) throw new Error("Sign in to reconnect Grove");
    if (!this.renewing)
      this.renewing = this.authorize(false).finally(() => {
        this.renewing = undefined;
      });
    return this.renewing;
  }
}
