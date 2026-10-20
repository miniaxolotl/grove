import { ModelSettings } from "@/components/dashboard/model-settings";
import { SettingsNavigation } from "@/components/dashboard/settings-navigation";
export default function ModelsPage() {
  return (
    <>
      <SettingsNavigation />
      <ModelSettings />
    </>
  );
}
