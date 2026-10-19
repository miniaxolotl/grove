"use client";

import { useClerk, useUser } from "@clerk/nextjs";
import { KeyRound } from "lucide-react";

export function ConnectedAccounts() {
  const { user, isLoaded } = useUser();
  const { openUserProfile } = useClerk();
  const accounts = user?.externalAccounts ?? [];

  return (
    <section className="app-panel" aria-labelledby="connected-accounts-heading">
      <h2
        id="connected-accounts-heading"
        className="flex items-center gap-3 font-editorial text-2xl"
      >
        <KeyRound size={19} aria-hidden="true" className="shrink-0" />
        Sign-in &amp; connected accounts
      </h2>
      <p className="mt-3 text-sm leading-7 text-muted">
        Add another way to sign in to this Grove account. Your memories and
        agent connections stay together.
      </p>
      {!isLoaded ? (
        <p className="mt-4 text-sm text-muted" role="status">
          Loading connected accounts…
        </p>
      ) : accounts.length ? (
        <ul className="mt-5 divide-y divide-line" aria-label="Connected accounts">
          {accounts.map((account) => (
            <li
              key={account.id}
              className="flex flex-wrap items-center justify-between gap-3 py-3"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium">{account.providerTitle()}</p>
                <p className="mt-1 break-all text-xs text-muted">
                  {account.accountIdentifier()}
                </p>
              </div>
              <span className="rounded-full bg-sage px-3 py-1 text-xs">
                {account.verification?.status === "verified"
                  ? "Connected"
                  : "Verification needed"}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-4 text-sm text-muted">
          You haven’t connected a social account yet.
        </p>
      )}
      <button
        type="button"
        className="app-button secondary mt-5"
        disabled={!isLoaded || !user}
        onClick={() => openUserProfile()}
      >
        {accounts.length ? "Manage connected accounts" : "Connect an account"}
      </button>
      <p className="mt-3 text-xs leading-6 text-muted">
        In your profile, choose Connected accounts, then Connect account to add
        an available provider. You can also update your profile, email, and
        account security there.
      </p>
    </section>
  );
}
