import { PageHeading } from "./ui/page-heading";
import { SettingsNavigation } from "./settings-navigation";

export function SettingsFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="settings-frame">
      <header className="settings-header">
        <PageHeading title="Settings" />
        <SettingsNavigation />
      </header>
      <div className="settings-page">{children}</div>
    </div>
  );
}
