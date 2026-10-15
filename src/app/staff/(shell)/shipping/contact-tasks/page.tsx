"use client";

import Link from "next/link";
import { useState } from "react";
import type { ContactTaskView } from "@/server/modules/shipping/contact-tasks-service";
import {
  Button,
  formatDate,
  Guard,
  Loaded,
  PageTitle,
  Pager,
  Select,
  StatusBadge,
  useAction,
  useApiData,
} from "../../../_components/catalog-ui";
import { staffApi } from "../../../_lib/api";
import { usePurchasingT } from "../../../_lib/purchasing-i18n";
import { useStaffSession } from "../../../_lib/session";
import { ShippingTabs } from "../tabs";

const PAGE_SIZE = 25;
const STATUSES = ["OPEN", "IN_PROGRESS", "RESOLVED", "CANCELLED"];

/** Customer-contact tasks after repeated failed deliveries (TASK-035, Q129). */
export default function ContactTasksPage() {
  return (
    <>
      <ShippingTabs />
      <Guard anyOf={["CONTACT_TASK_MANAGE"]}>
        <ContactTasks />
      </Guard>
    </>
  );
}

function ContactTasks() {
  const { c, p } = usePurchasingT();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("OPEN");
  const query = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
  if (status) query.set("status", status);
  const { state, reload } = useApiData<ContactTaskView[]>(`/api/v1/admin/contact-tasks?${query}`);

  return (
    <>
      <PageTitle>{p.contactTasks}</PageTitle>
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
        {(tasks) => (
          <>
            {tasks.length === 0 ? <p className="text-ink-soft">{c.empty}</p> : null}
            <ul className="grid gap-4">
              {tasks.map((task) => (
                <TaskItem key={task.id} task={task} onChange={reload} />
              ))}
            </ul>
            <Pager page={page} count={tasks.length} pageSize={PAGE_SIZE} onPage={setPage} />
          </>
        )}
      </Loaded>
    </>
  );
}

function TaskItem({ task, onChange }: { task: ContactTaskView; onChange: () => void }) {
  const { p } = usePurchasingT();
  const { session } = useStaffSession();
  const { run, pending, notice } = useAction(onChange);
  const [notes, setNotes] = useState(task.outcomeNotes ?? "");
  const open = task.status === "OPEN" || task.status === "IN_PROGRESS";
  const update = (body: Record<string, unknown>) =>
    void run(() =>
      staffApi(`/api/v1/admin/contact-tasks/${task.id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      }),
    );

  return (
    <li className="rounded-xl border border-line bg-white p-4">
      {notice}
      <div className="mb-2 flex flex-wrap items-center gap-3 text-sm">
        <Link
          href={`/staff/shipping/orders/${task.orderId}`}
          className="font-semibold text-plum hover:underline"
          dir="ltr"
        >
          {task.orderNumber}
        </Link>
        <StatusBadge status={task.status} />
        <span>{p.reasons[task.reason] ?? task.reason}</span>
        {task.attemptCount !== null ? (
          <span className="text-ink-soft">
            {p.attemptsShort}: {task.attemptCount}
          </span>
        ) : null}
        <span className="text-ink-soft">{formatDate(task.createdAt)}</span>
      </div>
      <p className="mb-3 text-sm">
        <span className="text-ink-soft">{p.assignedTo}: </span>
        {task.assignedEmployee?.displayName ?? p.unassigned}
        {task.resolvedBy ? ` · ${task.resolvedBy.displayName}` : ""}
      </p>
      <label className="mb-3 block text-sm text-ink-soft">
        <span className="mb-1 block">{p.outcome}</span>
        <textarea
          rows={2}
          maxLength={2000}
          value={notes}
          disabled={!open}
          onChange={(event) => setNotes(event.target.value)}
          className="block w-full rounded-md border border-line bg-velvet-low px-3 py-2 text-sm text-ink"
        />
      </label>
      {open ? (
        <div className="flex flex-wrap gap-2">
          <Button
            variant="plain"
            disabled={pending}
            onClick={() => update({ outcomeNotes: notes.trim() || null })}
          >
            {p.saveNotes}
          </Button>
          {task.assignedEmployee?.id === session.employee.id ? (
            <Button
              variant="plain"
              disabled={pending}
              onClick={() => update({ assignedEmployeeId: null })}
            >
              {p.unassign}
            </Button>
          ) : (
            <Button
              variant="plain"
              disabled={pending}
              onClick={() => update({ assignedEmployeeId: session.employee.id })}
            >
              {p.assignToMe}
            </Button>
          )}
          {task.status === "OPEN" ? (
            <Button disabled={pending} onClick={() => update({ status: "IN_PROGRESS" })}>
              {p.startTask}
            </Button>
          ) : null}
          <Button
            disabled={pending}
            onClick={() => update({ status: "RESOLVED", outcomeNotes: notes.trim() || null })}
          >
            {p.resolveTask}
          </Button>
          <Button
            variant="danger"
            disabled={pending}
            onClick={() => update({ status: "CANCELLED", outcomeNotes: notes.trim() || null })}
          >
            {p.cancelTask}
          </Button>
        </div>
      ) : null}
    </li>
  );
}
