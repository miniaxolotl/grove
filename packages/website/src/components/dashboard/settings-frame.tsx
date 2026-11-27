import { PageHeading } from "./ui/page-heading";
import { SettingsNavigation } from "./settings-navigation";
import "./settings-layout.css";

export function SettingsFrame({
  children,
  billing = false,
}: {
  children: React.ReactNode;
  billing?: boolean;
}) {
  return (
    <div className="settings-frame">
      <header className="settings-header">
        <PageHeading title="Settings" />
        <SettingsNavigation billing={billing} />
      </header>
      <div className="settings-page">{children}</div>
    </div>
  );
}
