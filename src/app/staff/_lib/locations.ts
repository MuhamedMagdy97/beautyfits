/**
 * Form shaping for the shipping-rule screen (TASK-055A). It only turns what
 * staff typed into a request body; the API validates and decides everything
 * (API "TASK-027 Amendments").
 */
import type { ShippingRuleView } from "@/server/modules/shipping/shipping-service";
import { fromLocalInput, toLocalInput } from "./marketing";
import { formatPiastres, parsePounds } from "./money";

export interface RuleForm {
  shippingCompanyId: string;
  governorateId: string;
  areaId: string;
  minOrderTotal: string;
  maxOrderTotal: string;
  shippingFee: string;
  priority: string;
  activeFrom: string;
  activeTo: string;
  status: "ACTIVE" | "INACTIVE";
}

export function ruleForm(rule?: ShippingRuleView): RuleForm {
  const pounds = (value: number | null | undefined) => formatPiastres(value) ?? "";
  return {
    shippingCompanyId: rule?.shippingCompanyId ?? "",
    governorateId: rule?.governorateId ?? "",
    areaId: rule?.areaId ?? "",
    minOrderTotal: pounds(rule?.minOrderTotal),
    maxOrderTotal: pounds(rule?.maxOrderTotal),
    shippingFee: pounds(rule?.shippingFee),
    priority: String(rule?.priority ?? 0),
    activeFrom: toLocalInput(rule?.activeFrom ?? null),
    activeTo: toLocalInput(rule?.activeTo ?? null),
    status: rule?.status ?? "ACTIVE",
  };
}

/**
 * The full rule body (create, or PATCH with `null` clearing optional fields),
 * or the first field that cannot be read. Money: pounds in, piastres out.
 */
export function ruleBody(
  form: RuleForm,
): { body: Record<string, unknown> } | { badField: keyof RuleForm } {
  const shippingFee = parsePounds(form.shippingFee);
  if (shippingFee === null) return { badField: "shippingFee" };
  const optionalPounds = (text: string) => (text.trim() === "" ? null : parsePounds(text));
  const minOrderTotal = optionalPounds(form.minOrderTotal);
  if (minOrderTotal === null && form.minOrderTotal.trim() !== "") {
    return { badField: "minOrderTotal" };
  }
  const maxOrderTotal = optionalPounds(form.maxOrderTotal);
  if (maxOrderTotal === null && form.maxOrderTotal.trim() !== "") {
    return { badField: "maxOrderTotal" };
  }
  const priorityText = form.priority.trim() || "0";
  if (!/^-?\d{1,4}$/.test(priorityText)) return { badField: "priority" };
  const activeFrom = fromLocalInput(form.activeFrom);
  if (activeFrom === null && form.activeFrom !== "") return { badField: "activeFrom" };
  const activeTo = fromLocalInput(form.activeTo);
  if (activeTo === null && form.activeTo !== "") return { badField: "activeTo" };
  return {
    body: {
      shippingCompanyId: form.shippingCompanyId || null,
      // An area implies its governorate; send both so the pickers stay consistent.
      governorateId: form.governorateId || null,
      areaId: form.governorateId ? form.areaId || null : null,
      minOrderTotal,
      maxOrderTotal,
      shippingFee,
      priority: Number(priorityText),
      activeFrom,
      activeTo,
      status: form.status,
    },
  };
}
