"use client";

import { useState } from "react";
import type { SupplierReturnView } from "@/server/modules/purchasing/supplier-returns-service";
import {
  Guard,
  Loaded,
  PageTitle,
  Pager,
  Select,
  useApiData,
} from "../../../_components/catalog-ui";
import { usePurchasingT } from "../../../_lib/purchasing-i18n";
import { PurchasingTabs, RETURN_READERS } from "../tabs";
import { ReturnsTable } from "./table";

const PAGE_SIZE = 25;
const STATUSES = ["DRAFT", "PENDING_APPROVAL", "APPROVED", "REJECTED", "SETTLED"];

/** Supplier returns of damaged goods (TASK-024, API "TASK-024 Amendments"). */
export default function SupplierReturnsPage() {
  return (
    <Guard anyOf={RETURN_READERS}>
      <SupplierReturns />
    </Guard>
  );
}

function SupplierReturns() {
  const { c, p } = usePurchasingT();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("");
  const query = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
  if (status) query.set("status", status);
  const { state, reload } = useApiData<SupplierReturnView[]>(
    `/api/v1/admin/supplier-returns?${query}`,
  );
  return (
    <>
      <PurchasingTabs />
      <PageTitle>{p.supplierReturns}</PageTitle>
      <div className="mb-4 max-w-xs">
        <Select
          label={c.status}
          value={status}
          onChange={(event) => {
            setStatus(event.target.value);
            setPage(1);
          }}
        >
          <option value="">{c.allStatuses}</option>
          {STATUSES.map((value) => (
            <option key={value} value={value}>
              {c.statuses[value]}
            </option>
          ))}
        </Select>
      </div>
      <Loaded load={state} reload={reload}>
        {(returns) => (
          <>
            <ReturnsTable returns={returns} />
            <Pager page={page} count={returns.length} pageSize={PAGE_SIZE} onPage={setPage} />
          </>
        )}
      </Loaded>
    </>
  );
}
