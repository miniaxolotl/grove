import { redirect } from "next/navigation";
export default function JournalPage() {
  redirect("/app?sort=created_desc");
}
