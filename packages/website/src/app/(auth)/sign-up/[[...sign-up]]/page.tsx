import { SignUp } from "@clerk/nextjs";
import { EntryNotice } from "../../entry-notice";

export const metadata = { title: "Create an account | Grove" };
export default function SignUpPage() {
  return process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY &&
    process.env.CLERK_SECRET_KEY ? (
    <SignUp fallback={<EntryNotice signUp loading />} />
  ) : (
    <EntryNotice signUp />
  );
}
