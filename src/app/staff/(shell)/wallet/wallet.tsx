"use client";

import { useRef, useState } from "react";
import type { WalletTransactionView, WalletView } from "@/server/modules/wallet/wallet-service";
import {
  Button,
  Card,
  Guard,
  Input,
  Loaded,
  PageTitle,
  Pager,
  Select,
  Table,
  useAction,
  useApiData,
  useCan,
} from "../../_components/catalog-ui";
import { staffApi } from "../../_lib/api";
import { idempotencyKeyFor, parseUuid } from "../../_lib/marketing";
import { useMarketingT } from "../../_lib/marketing-i18n";
import { formatPiastres, parsePounds } from "../../_lib/money";

const PAGE_SIZE = 20;

/**
 * Customer wallet (TASK-056 over TASK-028, API §18): balance, held and
 * available credit, the ledger with staff reasons (`VIEW_WALLET_BALANCE`),
 * and the manual credit/debit with a required reason (`ADJUST_WALLET`,
 * Owner/Admin only, Q78). There is no customer search endpoint yet, so the
 * wallet is opened by customer id.
 */
export function Wallet({ initialCustomer }: { initialCustomer: string }) {
  return (
    <Guard anyOf={["VIEW_WALLET_BALANCE"]}>
      <WalletLookup initialCustomer={initialCustomer} />
    </Guard>
  );
}

function WalletLookup({ initialCustomer }: { initialCustomer: string }) {
  const { t, m } = useMarketingT();
  const [typed, setTyped] = useState(initialCustomer);
  const [customerId, setCustomerId] = useState(parseUuid(initialCustomer));
  const [invalid, setInvalid] = useState(false);
  return (
    <section>
      <PageTitle>{t.sections.wallet}</PageTitle>
      <p className="mb-4 max-w-2xl text-ink-soft">{m.walletIntro}</p>
      <form
        className="mb-6 flex flex-wrap items-end gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          const id = parseUuid(typed);
          setInvalid(id === null);
          setCustomerId(id);
        }}
      >
        <div className="min-w-72 flex-1">
          <Input
            label={m.customerId}
            dir="ltr"
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
          />
        </div>
        <Button type="submit">{m.lookUp}</Button>
      </form>
      {invalid ? <p className="mb-4 text-sm text-danger">{m.badCustomerId}</p> : null}
      {customerId ? <CustomerWallet key={customerId} customerId={customerId} /> : null}
    </section>
  );
}

function CustomerWallet({ customerId }: { customerId: string }) {
  const { m, date } = useMarketingT();
  const can = useCan();
  const [page, setPage] = useState(1);
  const base = `/api/v1/admin/customers/${customerId}/wallet`;
  const wallet = useApiData<WalletView>(base);
  const list = useApiData<WalletTransactionView[]>(
    `${base}/transactions?page=${page}&pageSize=${PAGE_SIZE}`,
  );
  const reload = () => {
    wallet.reload();
    list.reload();
  };
  const money = (value: number) => formatPiastres(value) ?? m.none;

  return (
    <>
      <Loaded load={wallet.state} reload={wallet.reload}>
        {(w) => (
          <Card>
            <dl className="grid gap-4 sm:grid-cols-3">
              {(
                [
                  [m.balance, w.balance],
                  [m.reserved, w.reserved],
                  [m.available, w.available],
                ] as const
              ).map(([label, value]) => (
                <div key={label}>
                  <dt className="text-sm text-ink-soft">{label}</dt>
                  <dd
                    className="font-[family-name:var(--font-display)] text-2xl text-ink"
                    dir="ltr"
                  >
                    {money(value)} {w.currency}
                  </dd>
                </div>
              ))}
            </dl>
          </Card>
        )}
      </Loaded>
      {can("ADJUST_WALLET") && wallet.state.status === "ready" ? (
        <AdjustForm path={`${base}/adjust`} onDone={reload} />
      ) : null}
      <Card title={m.transactions}>
        <Loaded load={list.state} reload={list.reload}>
          {(items) =>
            items.length === 0 ? (
              <p className="text-ink-soft">{m.empty}</p>
            ) : (
              <>
                <Table head={[m.created, m.type, m.amount, m.reference, m.reason]}>
                  {items.map((tx) => (
                    <tr key={tx.id}>
                      <td className="px-3 py-2 text-xs">{date(tx.createdAt)}</td>
                      <td className="px-3 py-2">{m.walletTypes[tx.type] ?? tx.type}</td>
                      <td
                        className={`px-3 py-2 ${tx.signedAmount < 0 ? "text-danger" : "text-plum"}`}
                        dir="ltr"
                      >
                        {tx.signedAmount > 0 ? "+" : ""}
                        {money(tx.signedAmount)}
                      </td>
                      <td className="px-3 py-2 text-xs" dir="ltr">
                        {tx.referenceType ? `${tx.referenceType} ${tx.referenceId ?? ""}` : m.none}
                      </td>
                      <td className="px-3 py-2">{tx.reason ?? m.none}</td>
                    </tr>
                  ))}
                </Table>
                <Pager page={page} count={items.length} pageSize={PAGE_SIZE} onPage={setPage} />
              </>
            )
          }
        </Loaded>
      </Card>
    </>
  );
}

/**
 * Manual adjustment. The `Idempotency-Key` stays the same while the same
 * request is retried (a lost answer cannot post twice) and changes when the
 * request changes or after it succeeded.
 */
function AdjustForm({ path, onDone }: { path: string; onDone: () => void }) {
  const { m } = useMarketingT();
  const [direction, setDirection] = useState<"CREDIT" | "DEBIT">("CREDIT");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const key = useRef<{ fingerprint: string; key: string } | null>(null);
  const action = useAction(() => {
    key.current = null;
    setAmount("");
    setReason("");
    onDone();
  });

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const piastres = parsePounds(amount);
    if (!piastres) {
      action.fail(m.badAmount);
      return;
    }
    const confirm = m.adjustConfirm
      .replace("{direction}", m.directions[direction])
      .replace("{amount}", formatPiastres(piastres) ?? "");
    if (!window.confirm(confirm)) return;
    const body = { direction, amount: piastres, reason: reason.trim() };
    key.current = idempotencyKeyFor(key.current, body);
    const idempotencyKey = key.current.key;
    void action.run(
      () =>
        staffApi(path, {
          method: "POST",
          headers: { "Idempotency-Key": idempotencyKey },
          body: JSON.stringify(body),
        }),
      m.adjusted,
    );
  }

  return (
    <Card title={m.adjust}>
      <form className="grid gap-4 sm:grid-cols-3" onSubmit={submit}>
        <Select
          label={m.direction}
          value={direction}
          onChange={(event) => setDirection(event.target.value as "CREDIT" | "DEBIT")}
        >
          <option value="CREDIT">{m.directions.CREDIT}</option>
          <option value="DEBIT">{m.directions.DEBIT}</option>
        </Select>
        <Input
          label={m.amount}
          inputMode="decimal"
          required
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
        />
        <Input
          label={m.reasonRequired}
          required
          maxLength={500}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />
        <div className="sm:col-span-3">
          {action.notice}
          <Button type="submit" disabled={action.pending || reason.trim() === ""}>
            {m.adjust}
          </Button>
        </div>
      </form>
    </Card>
  );
}
