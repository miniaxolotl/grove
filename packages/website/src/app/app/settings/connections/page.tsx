import { Connections } from "@/components/dashboard/connections";
export default function ConnectionsPage() {
  return <Connections origin={process.env.GROVE_API_URL ?? ""} />;
}
