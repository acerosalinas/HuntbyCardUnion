import { requireTrackerAdminOrRedirect } from "@/lib/tracker/auth";
import { loadTrackerData } from "@/lib/tracker/data";
import { SettingsForm } from "@/components/tracker/SettingsForm";

export const dynamic = "force-dynamic";

export default async function TrackerSettingsPage() {
  const admin = await requireTrackerAdminOrRedirect();
  const { settings } = await loadTrackerData(admin.id);
  return <SettingsForm settings={settings} />;
}
