import { ClerkProvider } from "@clerk/nextjs";

/** Account routes own authentication; public readers never mount its browser SDK. */
export function AuthenticationProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  if (!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) return children;
  return (
    <ClerkProvider
      signInUrl="/sign-in"
      signUpUrl="/sign-up"
      signInFallbackRedirectUrl="/app"
      signUpFallbackRedirectUrl="/app"
      appearance={{
        variables: {
          colorPrimary: "#326349",
          colorPrimaryForeground: "#fffef9",
          colorBackground: "#fffef9",
          colorForeground: "#253e31",
          colorMutedForeground: "#5d6962",
          colorInput: "#ffffff",
          colorInputForeground: "#253e31",
          colorBorder: "#dce0d3",
          colorDanger: "#833323",
          colorRing: "#32634980",
          colorModalBackdrop: "#15251bb3",
          borderRadius: "0.75rem",
          fontFamily: "var(--font-space-grotesk)",
        },
        options: {
          logoImageUrl: "/icon.svg",
          logoLinkUrl: "/",
          privacyPageUrl: "/privacy",
          termsPageUrl: "/terms",
          helpPageUrl: "mailto:hello@bramblelabs.co",
        },
      }}
    >
      {children}
    </ClerkProvider>
  );
}
