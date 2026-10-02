# ADR-0025 — Inventory reservations

- **Status:** Accepted (TASK-020); the decision in §3 taken by the product owner on 2026-10-03
- **Date:** 2026-10-03
- **Relates to:** ADR-0010 (transactions), ADR-0024 (inventory ledger); Business Spec Q9, Q25, Q28, Q36, R11; User Flows §13.2–13.3, order state table; Architecture §8, §9; DB Design §10 and "v1.2 TASK-020 Amendments"; API Contract §9 "Inventory concurrency" and "TASK-020 Amendments"

## 1. Engine

`src/server/modules/inventory/reservations.ts`: functions that take the caller's transaction, so an order and its stock hold commit together (Q9, Q28, User Flows §8):

| Function | Movement | Balance | Reservation |
|---|---|---|---|
| `reserveForOrder(tx, { orderId, lines, actor, now })` | `RESERVATION` per variant | Available − q, Reserved + q | new `ACTIVE` rows |
| `releaseForOrder(tx, { orderId, actor, now, reason })` | `RELEASE_RESERVATION` | Reserved − q, Available + q | `ACTIVE` → `RELEASED` |
| `commitForOrder(tx, { orderId, actor, now })` | `CUSTOMER_ORDER_COMMIT` | Reserved − q | `ACTIVE` → `CONVERTED` |

Every movement has `reference_type = 'ORDER'` and the order id, so each order's stock history can be traced from the ledger (Q108).

## 2. Oversell prevention and concurrency

- `reserveForOrder` merges the lines per variant, locks the balances (`SELECT … FOR UPDATE`) in variant id order, and checks Available for every line before writing anything. One short line refuses the whole order with `STOCK_CHANGED` (`details.items` names the short variants only; counts are internal). No partial reservations.
- Locking and writing in variant id order means two orders over the same variants never deadlock (tested with orders listing them in opposite order).
- The balance check of ADR-0024 (no quantity below zero) is the last line of defence: even code that skipped the lock could not oversell.
- Release and commit lock the order's `ACTIVE` reservation rows first; a concurrent retry waits and then finds nothing to do. Both are no-ops when the order holds nothing, so expiry jobs and retried requests are safe.
- An order reserves once (`ORDER_ALREADY_RESERVED`); an edit (TASK-032) releases and reserves again.

## 3. Decision by the product owner (2026-10-03)

Reserved stock is **consumed when the order is Shipped** (the carrier physically takes it). Before that, a cancellation or expiry releases it to Available (Q25, Q28, R11). After pickup, goods come back only through return-to-sender and inspection, and only inspected sellable items return to Available (Q36). Settles DB Design §10 `[BUSINESS DECISION REQUIRED]`; that reserving and releasing write movements follows from AGENTS.md and ADR-0024's balance guard.

## 4. Technical defaults

1. `orders` does not exist yet: `inventory_reservations.order_id` has no foreign key until TASK-030.
2. The engine does not check the product's status or price: checkout (TASK-029) validates what may be bought; the engine only holds stock.
3. Reservations are history: a trigger rejects deletes and any change other than `ACTIVE` → `RELEASED`/`CONVERTED`, once.
4. No audit entries: the movements are the record; the order tasks audit the order status changes that cause them.
5. No HTTP endpoints; admin stock views already show `reservedQuantity` and the movements.

## Consequences

- Migration `inventory_reservations` (one table, one enum, three movement types, two checks, one trigger).
- TASK-029 calls `reserveForOrder` in the checkout transaction; TASK-031/TASK-033 call `releaseForOrder` on expiry and cancellation; the shipping task calls `commitForOrder` at `SHIPPED`.
- No new dependency.
