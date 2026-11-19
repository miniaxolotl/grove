import { GroveMark } from "@/components/brand";
import styles from "./entry.module.css";

export function EntryNotice({ signUp = false, loading = false }) {
  const task = signUp ? "Sign-up" : "Sign-in";
  return (
    <>
      <section className={styles.notice}>
        <GroveMark className="size-9" />
        <h1>{signUp ? "Create your Grove account" : "Sign in to Grove"}</h1>
        <p role={loading ? "status" : undefined}>
          {loading
            ? `Loading ${signUp ? "sign-up" : "sign-in"}…`
            : `${task} is unavailable right now. Please try again later.`}
        </p>
      </section>
    </>
  );
}
