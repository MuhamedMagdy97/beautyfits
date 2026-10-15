import type { Metadata } from "next";
import { NotificationList } from "./notification-list";

export const metadata: Metadata = { robots: { index: false, follow: false } };

/** In-app notifications (TASK-060): `/account/notifications?page=`. */
export default async function NotificationsPage({
  searchParams,
}: PageProps<"/account/notifications">) {
  const { page } = await searchParams;
  return <NotificationList page={Math.max(1, Number.parseInt(String(page ?? ""), 10) || 1)} />;
}
