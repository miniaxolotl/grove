type Identity = { userId: string | null; sessionId: string | null };
type RegistrationUser = {
  id: string;
  createdAt: number;
  banned: boolean;
  locked: boolean;
};
type RegistrationSession = {
  id: string;
  userId: string;
  status: string;
  createdAt: number;
  expireAt: number;
  actor: unknown;
};

export async function verifyNewRegistration(
  identity: Identity | null,
  provider: {
    getUser(id: string): Promise<RegistrationUser>;
    getSession(id: string): Promise<RegistrationSession>;
  },
  now: number = Date.now(),
) {
  if (!identity?.userId || !identity.sessionId) return false;
  try {
    const [user, session] = await Promise.all([
      provider.getUser(identity.userId),
      provider.getSession(identity.sessionId),
    ]);
    return isNewRegistration(identity, user, session, now);
  } catch {
    // Marketing measurement must never block access or expose provider responses.
    return false;
  }
}

export function isNewRegistration(
  identity: Identity | null,
  user: RegistrationUser | null,
  session: RegistrationSession | null,
  now: number,
) {
  if (
    !identity?.userId ||
    !identity.sessionId ||
    !user ||
    !session ||
    user.id !== identity.userId ||
    session.id !== identity.sessionId ||
    session.userId !== user.id ||
    user.banned !== false ||
    user.locked !== false ||
    session.status !== "active" ||
    session.actor !== null
  )
    return false;
  const milliseconds = (value: number) =>
    Number.isSafeInteger(value) && value >= 1e12;
  if (
    ![now, user.createdAt, session.createdAt, session.expireAt].every(
      milliseconds,
    )
  )
    return false;
  return (
    user.createdAt <= now &&
    session.createdAt <= now &&
    now - user.createdAt <= 15 * 60_000 &&
    session.createdAt >= user.createdAt &&
    session.createdAt - user.createdAt <= 60_000 &&
    session.expireAt > now
  );
}
