import { SettingsFrame } from "@/components/dashboard/settings-frame";

export default function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <SettingsFrame>{children}</SettingsFrame>;
}
