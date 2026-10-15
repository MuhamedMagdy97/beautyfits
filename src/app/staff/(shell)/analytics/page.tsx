"use client";

import { useState } from "react";
import { Guard, Input, PageTitle, useCan } from "../../_components/catalog-ui";
import { Notice } from "../../_components/ui";
import { RANGES, type Range, reportQuery } from "../../_lib/analytics";
import { useAnalyticsT } from "../../_lib/analytics-i18n";
import { FunnelReport, OverviewReport, ProductsReport, ProfitReport } from "./report";

/**
 * Analytics (TASK-052A over TASK-051, ADR-0052, ADR-0065): sales KPIs, the
 * funnel and product performance for `ANALYTICS_VIEW`; costs and profit only
 * when the session also holds `VIEW_PROFIT` (the API leaves them out
 * otherwise).
 */
export default function AnalyticsPage() {
  return (
    <Guard anyOf={["ANALYTICS_VIEW"]}>
      <Analytics />
    </Guard>
  );
}

function Analytics() {
  const { x } = useAnalyticsT();
  const can = useCan();
  const [range, setRange] = useState<Range>("30D");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const query = reportQuery(range, from, to);

  return (
    <section>
      <PageTitle>{x.analytics}</PageTitle>
      <fieldset className="mb-6">
        <legend className="mb-2 text-sm text-ink-soft">{x.period}</legend>
        <div className="flex flex-wrap gap-2">
          {RANGES.map((r) => (
            <button
              key={r}
              type="button"
              aria-pressed={range === r}
              onClick={() => setRange(r)}
              className={`rounded-full border px-3 py-1 text-sm ${
                range === r
                  ? "border-plum bg-plum text-white"
                  : "border-line text-plum hover:bg-velvet-low"
              }`}
            >
              {x.ranges[r]}
            </button>
          ))}
        </div>
        {range === "CUSTOM" ? (
          <div className="mt-3 flex flex-wrap gap-3">
            <div className="w-44">
              <Input
                label={x.from}
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
              />
            </div>
            <div className="w-44">
              <Input label={x.to} type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
          </div>
        ) : null}
      </fieldset>
      {query === null ? (
        <Notice tone="info">{x.pickDays}</Notice>
      ) : (
        <>
          <OverviewReport query={query} />
          <FunnelReport query={query} />
          <ProductsReport key={query} query={query} />
          {can("VIEW_PROFIT") ? <ProfitReport query={query} /> : null}
        </>
      )}
    </section>
  );
}
