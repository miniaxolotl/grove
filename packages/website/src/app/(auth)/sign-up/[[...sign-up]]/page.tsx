import { SignUp } from "@clerk/nextjs";
import { AuthSetup } from "@/components/auth-setup";
export default function SignUpPage() {
  return process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY &&
    process.env.CLERK_SECRET_KEY ? (
    <SignUp />
  ) : (
    <AuthSetup />
  );
}
