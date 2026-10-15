"use client";

import { useEffect, useState } from "react";
import type { CampaignView } from "@/server/modules/marketing/campaigns-service";
import { Button, Card, Input, Select, TextArea, useAction } from "../../_components/catalog-ui";
import { staffApi, staffPost } from "../../_lib/api";
import {
  SEGMENT_TYPES,
  segmentDefinition,
  segmentForm,
  type SegmentForm,
} from "../../_lib/marketing";
import { useMarketingT } from "../../_lib/marketing-i18n";
import { ProductPicker, TaxonomyPicker } from "../discounts/targets";

/**
 * Campaign draft form (TASK-056 over TASK-048): name, audience (a TASK-047
 * segment with its live opted-in count), subject for email, plain-text
 * content. Creates with `POST /admin/campaigns`, edits with `PATCH`.
 */
export function CampaignEditor({
  campaign,
  onSaved,
  onCancel,
}: {
  campaign?: CampaignView;
  onSaved: (saved: CampaignView) => void;
  onCancel: () => void;
}) {
  const { m } = useMarketingT();
  const [name, setName] = useState(campaign?.name ?? "");
  const [segment, setSegment] = useState<SegmentForm>(() => segmentForm(campaign?.segment));
  const [subject, setSubject] = useState(campaign?.subject ?? "");
  const [content, setContent] = useState(campaign?.content ?? "");
  const action = useAction();
  const definition = segmentDefinition(segment);
  const email = segment.channel === "EMAIL";
  const set =
    <K extends keyof SegmentForm>(key: K) =>
    (value: SegmentForm[K]) =>
      setSegment({ ...segment, [key]: value });

  function save(event: React.FormEvent) {
    event.preventDefault();
    if (!definition) {
      action.fail(m.audienceIncomplete);
      return;
    }
    const body = {
      name: name.trim(),
      segment: definition,
      subject: email ? subject.trim() : null,
      content: content.trim(),
    };
    void action.run(async () => {
      const saved = campaign
        ? await staffApi<CampaignView>(`/api/v1/admin/campaigns/${campaign.id}`, {
            method: "PATCH",
            body: JSON.stringify(body),
          })
        : await staffPost<CampaignView>("/api/v1/admin/campaigns", body);
      onSaved(saved);
    });
  }

  return (
    <Card title={campaign ? m.edit : m.newCampaign}>
      <form className="grid gap-4" onSubmit={save}>
        <Input
          label={m.name}
          required
          maxLength={200}
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <fieldset className="grid gap-4 rounded-md border border-line p-3">
          <legend className="px-1 text-sm text-ink-soft">{m.segment}</legend>
          <div className="grid gap-4 sm:grid-cols-2">
            <Select
              label={m.channel}
              value={segment.channel}
              onChange={(event) => set("channel")(event.target.value as SegmentForm["channel"])}
            >
              <option value="EMAIL">{m.channels.EMAIL}</option>
              <option value="WHATSAPP">{m.channels.WHATSAPP}</option>
            </Select>
            <Select
              label={m.segment}
              value={segment.type}
              onChange={(event) => set("type")(event.target.value as SegmentForm["type"])}
            >
              {SEGMENT_TYPES.map((type) => (
                <option key={type} value={type}>
                  {m.segmentTypes[type]}
                </option>
              ))}
            </Select>
          </div>
          {segment.type === "PRODUCT_BUYERS" ? (
            <ProductPicker value={segment.productIds} onChange={set("productIds")} />
          ) : null}
          {segment.type === "BRAND_BUYERS" ? (
            <TaxonomyPicker kind="brands" value={segment.brandIds} onChange={set("brandIds")} />
          ) : null}
          {segment.type === "CATEGORY_BUYERS" ? (
            <TaxonomyPicker
              kind="categories"
              value={segment.categoryIds}
              onChange={set("categoryIds")}
            />
          ) : null}
          {segment.type === "INACTIVE" ? (
            <Input
              label={m.inactiveDays}
              type="number"
              min={1}
              max={3650}
              value={segment.inactiveDays}
              onChange={(event) => set("inactiveDays")(event.target.value)}
            />
          ) : null}
          {segment.type === "HIGH_SPENDING" ? (
            <Input
              label={m.minSpent}
              inputMode="decimal"
              value={segment.minSpent}
              onChange={(event) => set("minSpent")(event.target.value)}
            />
          ) : null}
          <AudienceCount definition={definition} />
        </fieldset>
        {email ? (
          <Input
            label={m.subject}
            required
            maxLength={200}
            value={subject}
            onChange={(event) => setSubject(event.target.value)}
          />
        ) : null}
        <TextArea
          label={m.content}
          required
          rows={6}
          maxLength={10_000}
          value={content}
          onChange={(event) => setContent(event.target.value)}
        />
        {action.notice}
        <div className="flex gap-2">
          <Button type="submit" disabled={action.pending}>
            {m.save}
          </Button>
          <Button variant="plain" onClick={onCancel}>
            {m.cancel}
          </Button>
        </div>
      </form>
    </Card>
  );
}

/** Live `POST /admin/segments/preview` count, refreshed shortly after the audience changes. */
function AudienceCount({ definition }: { definition: ReturnType<typeof segmentDefinition> }) {
  const { m, fail } = useMarketingT();
  const key = definition ? JSON.stringify(definition) : null;
  const [result, setResult] = useState<{ key: string; text: string } | null>(null);
  useEffect(() => {
    if (!key) return;
    let active = true;
    const timer = setTimeout(() => {
      staffPost<{ customerCount: number }>("/api/v1/admin/segments/preview", JSON.parse(key)).then(
        (preview) =>
          active &&
          setResult({ key, text: m.audience.replace("{n}", String(preview.customerCount)) }),
        (error: unknown) => active && setResult({ key, text: fail(error) }),
      );
    }, 400);
    return () => {
      active = false;
      clearTimeout(timer);
    };
    // `m` and `fail` change with the language only; the count follows the audience.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return (
    <p className="text-sm text-plum" aria-live="polite">
      {!key ? m.audienceIncomplete : result?.key === key ? result.text : "…"}
    </p>
  );
}
