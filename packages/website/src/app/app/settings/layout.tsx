import { SettingsFrame } from "@/components/dashboard/settings-frame";
import { showBilling } from "@/lib/flags";

export default async function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <SettingsFrame billing={await showBilling()}>{children}</SettingsFrame>
  );
}
