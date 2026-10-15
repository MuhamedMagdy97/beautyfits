"use client";

import type { PurchaseView } from "@/server/modules/purchasing/purchase-orders-service";
import type { SupplierReturnView } from "@/server/modules/purchasing/supplier-returns-service";
import { Card, Loaded, useApiData, useCan } from "../../../_components/catalog-ui";
import { usePurchasingT } from "../../../_lib/purchasing-i18n";
import { ReturnsTable } from "../returns/table";
import { RETURN_READERS } from "../tabs";

/** Supplier returns of one purchase order (TASK-024), for their readers. */
export function PurchaseReturnsCard({ purchase }: { purchase: PurchaseView }) {
  const can = useCan();
  if (!RETURN_READERS.some(can)) {
    return null;
  }
  return <Returns purchase={purchase} />;
}

function Returns({ purchase }: { purchase: PurchaseView }) {
  const { p } = usePurchasingT();
  const can = useCan();
  const { state, reload } = useApiData<SupplierReturnView[]>(
    `/api/v1/admin/supplier-returns?purchaseId=${purchase.id}&pageSize=100`,
  );
  const damaged = purchase.items.some((item) => item.damagedQuantity > 0);
  return (
    <Card title={p.returnsOfPurchase}>
      {damaged && can("SUPPLIER_RETURN_MANAGE") ? (
        <p className="mb-3 text-sm text-ink-soft">{p.returnCreateUnavailable}</p>
      ) : null}
      <Loaded load={state} reload={reload}>
        {(returns) => <ReturnsTable returns={returns} />}
      </Loaded>
    </Card>
  );
}
