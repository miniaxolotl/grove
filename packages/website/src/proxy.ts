import { clerkMiddleware } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

// Authentication is enforced by the dashboard layout and each data route.
const middleware = clerkMiddleware(async (auth, request) => {
  // Preserve the exact pending connection across browser sign-in/sign-up.
  if (request.nextUrl.pathname.startsWith("/app/connect/"))
    await auth.protect();
});
export default function proxy(...args: Parameters<typeof middleware>) {
  if (
    !process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ||
    !process.env.CLERK_SECRET_KEY
  )
    return NextResponse.next();
  return middleware(...args);
}
export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api)(.*)",
  ],
};
