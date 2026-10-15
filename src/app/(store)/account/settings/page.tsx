import type { Metadata } from "next";
import { SettingsView } from "./settings-view";

export const metadata: Metadata = { robots: { index: false, follow: false } };

/** Email, mobile, marketing choices and account closing (TASK-060). */
export default function SettingsPage() {
  return <SettingsView />;
}
