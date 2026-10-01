import type { EmailMessage } from "@/server/email/email";

/**
 * Employee invitation email (Q64, ADR-0016). Staff have no language
 * preference, so it carries Arabic first, then English (R14, as the staff
 * code emails of ADR-0015).
 *
 * The token goes in the URL fragment (`#token=`), which browsers never send
 * to a server, so it does not end up in access logs or `Referer` headers.
 */
export function invitationLink(dashboardUrl: string, token: string): string {
  return `${dashboardUrl}/staff/accept-invitation#token=${encodeURIComponent(token)}`;
}

export function invitationEmail(input: {
  to: string;
  displayName: string;
  link: string;
  expiresAt: Date;
}): EmailMessage {
  const until = input.expiresAt.toISOString().replace("T", " ").slice(0, 16) + " UTC";
  const ar =
    `مرحبًا ${input.displayName}،\n\n` +
    "تمت دعوتك للانضمام إلى فريق عمل BeautyFits.\n" +
    `لإنشاء حسابك واختيار كلمة المرور، افتح هذا الرابط:\n${input.link}\n\n` +
    `صالح حتى ${until}. لا تشارك هذا الرابط مع أي شخص.\n\n` +
    "إذا لم تكن تتوقع هذه الدعوة، يمكنك تجاهل هذه الرسالة.\n";
  const en =
    `Hello ${input.displayName},\n\n` +
    "You have been invited to join the BeautyFits staff.\n" +
    `To create your account and choose a password, open this link:\n${input.link}\n\n` +
    `It is valid until ${until}. Do not share this link with anyone.\n\n` +
    "If you were not expecting this invitation, you can ignore this email.\n";
  return {
    to: input.to,
    subject: "دعوة للانضمام إلى فريق BeautyFits | Invitation to join the BeautyFits staff",
    text: `${ar}\n---\n\n${en}`,
  };
}
