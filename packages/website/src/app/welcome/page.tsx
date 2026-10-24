import { auth, clerkClient } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { Brand } from "@/components/brand";
import { CookieSettings } from "@/components/cookie-consent";
import { RegistrationComplete } from "@/components/registration-complete";
import { verifyNewRegistration } from "@/lib/registration-eligibility";

export const metadata = {
  title: "Your notebook is ready | Grove",
  robots: { index: false, follow: false },
};
export const dynamic = "force-dynamic";

export default async function WelcomePage() {
  if (
    !process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ||
    !process.env.CLERK_SECRET_KEY
  )
    redirect("/sign-up");
  const { userId, sessionId } = await auth();
  if (!userId || !sessionId) redirect("/sign-up");
  const client = await clerkClient();
  const eligible = await verifyNewRegistration(
    { userId, sessionId },
    {
      getUser: (id) => client.users.getUser(id),
      getSession: (id) => client.sessions.getSession(id),
    },
  );
  if (!eligible) redirect("/app");
  return (
    <main id="main" className="page-container py-12 sm:py-20">
      <Brand />
      <section className="mt-16 max-w-lg" aria-labelledby="welcome-heading">
        <h1
          id="welcome-heading"
          className="text-4xl font-medium leading-tight sm:text-5xl"
        >
          Your notebook is ready.
        </h1>
        <p className="mt-5 max-w-md text-base leading-7 text-muted">
          Your Grove account is created. Start with a thought, a plan or a page
          about your day.
        </p>
        {/* A full document navigation unloads all marketing vendors before notes render. */}
        <a href="/app" className="button-primary mt-8">
          Open your notebook
        </a>
        <div className="mt-12 text-sm">
          <CookieSettings />
        </div>
      </section>
      <RegistrationComplete />
    </main>
  );
}
