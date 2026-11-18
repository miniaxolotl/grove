import { SignIn } from "@clerk/nextjs";
import { EntryNotice } from "../../entry-notice";

export const metadata = { title: "Sign in | Grove" };
export default function SignInPage() {
  return process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY &&
    process.env.CLERK_SECRET_KEY ? (
    <SignIn fallback={<EntryNotice loading />} />
  ) : (
    <EntryNotice />
  );
}
