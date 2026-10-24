import { PageHeading } from "./ui/page-heading";
import { SettingsNavigation } from "./settings-navigation";
import { PreferenceEditor } from "./preference-editor";

export function SettingsFrame({
  children,
  billing = false,
}: {
  children: React.ReactNode;
  billing?: boolean;
}) {
  return (
    <PreferenceEditor>
      <div className="settings-frame">
        <header className="settings-header">
          <PageHeading title="Settings" />
          <SettingsNavigation billing={billing} />
        </header>
        <div className="settings-page">{children}</div>
      </div>
    </PreferenceEditor>
  );
}
