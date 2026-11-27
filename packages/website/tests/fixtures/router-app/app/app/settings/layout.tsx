import { SettingsFrame } from "@/components/dashboard/settings-frame";
export default function Layout({ children }: { children: React.ReactNode }) {
  return <SettingsFrame billing={false}>{children}</SettingsFrame>;
}
