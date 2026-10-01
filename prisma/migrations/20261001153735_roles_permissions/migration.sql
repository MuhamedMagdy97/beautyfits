-- CreateTable
CREATE TABLE "roles" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "is_system_role" BOOLEAN NOT NULL DEFAULT false,
    "created_by_employee_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permissions" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT NOT NULL,

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "role_id" UUID NOT NULL,
    "permission_id" UUID NOT NULL,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("role_id","permission_id")
);

-- CreateTable
CREATE TABLE "employee_roles" (
    "employee_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "assigned_by_employee_id" UUID,
    "assigned_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "employee_roles_pkey" PRIMARY KEY ("employee_id","role_id")
);

-- CreateTable
CREATE TABLE "employee_invitations" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "department" TEXT,
    "employee_level" "employee_level" NOT NULL,
    "role_ids_json" JSONB NOT NULL,
    "invited_by_employee_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "accepted_at" TIMESTAMPTZ(3),
    "accepted_employee_id" UUID,
    "revoked_at" TIMESTAMPTZ(3),
    "revoked_by_employee_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "employee_invitations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "roles_name_key" ON "roles"("name");

-- CreateIndex
CREATE UNIQUE INDEX "permissions_code_key" ON "permissions"("code");

-- CreateIndex
CREATE INDEX "role_permissions_permission_id_idx" ON "role_permissions"("permission_id");

-- CreateIndex
CREATE INDEX "employee_roles_role_id_idx" ON "employee_roles"("role_id");

-- CreateIndex
CREATE UNIQUE INDEX "employee_invitations_token_hash_key" ON "employee_invitations"("token_hash");

-- CreateIndex
CREATE UNIQUE INDEX "employee_invitations_accepted_employee_id_key" ON "employee_invitations"("accepted_employee_id");

-- CreateIndex
CREATE INDEX "employee_invitations_email_idx" ON "employee_invitations"("email");

-- CreateIndex
CREATE INDEX "employees_status_employee_level_idx" ON "employees"("status", "employee_level");

-- AddForeignKey
ALTER TABLE "roles" ADD CONSTRAINT "roles_created_by_employee_id_fkey" FOREIGN KEY ("created_by_employee_id") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_id_fkey" FOREIGN KEY ("permission_id") REFERENCES "permissions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_roles" ADD CONSTRAINT "employee_roles_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_roles" ADD CONSTRAINT "employee_roles_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_roles" ADD CONSTRAINT "employee_roles_assigned_by_employee_id_fkey" FOREIGN KEY ("assigned_by_employee_id") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_invitations" ADD CONSTRAINT "employee_invitations_invited_by_employee_id_fkey" FOREIGN KEY ("invited_by_employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_invitations" ADD CONSTRAINT "employee_invitations_revoked_by_employee_id_fkey" FOREIGN KEY ("revoked_by_employee_id") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_invitations" ADD CONSTRAINT "employee_invitations_accepted_employee_id_fkey" FOREIGN KEY ("accepted_employee_id") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Permission catalog (docs/security/permission-catalog.md, Business Spec R17).
-- Reference data: the codes must match src/server/modules/rbac/catalog.ts.
INSERT INTO "permissions" ("id", "code", "description") VALUES
  (gen_random_uuid(), 'PRODUCT_VIEW', 'View products/variants in the dashboard'),
  (gen_random_uuid(), 'PRODUCT_CREATE', 'Create products/variants (Draft)'),
  (gen_random_uuid(), 'PRODUCT_EDIT', 'Edit product/variant content (not price, cost, media)'),
  (gen_random_uuid(), 'PRODUCT_PUBLISH', 'Publish / unpublish'),
  (gen_random_uuid(), 'PRODUCT_ARCHIVE', 'Archive / disable'),
  (gen_random_uuid(), 'MANAGE_PRODUCT_MEDIA', 'Upload/remove/order images'),
  (gen_random_uuid(), 'EDIT_PRODUCT_PRICE', 'Change selling price'),
  (gen_random_uuid(), 'VIEW_COST_PRICE', 'See purchase cost, weighted average cost'),
  (gen_random_uuid(), 'EDIT_COST_PRICE', 'Edit cost values where allowed'),
  (gen_random_uuid(), 'TAXONOMY_MANAGE', 'Create/edit categories and brands'),
  (gen_random_uuid(), 'REVIEW_MODERATE', 'Hide/restore reviews, handle reports'),
  (gen_random_uuid(), 'INVENTORY_VIEW', 'Stock levels, movements, low-stock alerts'),
  (gen_random_uuid(), 'ADJUST_INVENTORY', 'Manual stock adjustment (reason required)'),
  (gen_random_uuid(), 'SUPPLIER_VIEW', 'View suppliers'),
  (gen_random_uuid(), 'SUPPLIER_MANAGE', 'Edit suppliers'),
  (gen_random_uuid(), 'PURCHASE_VIEW', 'View purchase orders'),
  (gen_random_uuid(), 'PURCHASE_CREATE', 'Draft and submit purchase orders'),
  (gen_random_uuid(), 'PURCHASE_APPROVE', 'Approve purchase orders and over-delivery extras'),
  (gen_random_uuid(), 'RECEIVE_PURCHASE', 'Record goods receipts and inspection'),
  (gen_random_uuid(), 'SUPPLIER_RETURN_MANAGE', 'Create supplier returns'),
  (gen_random_uuid(), 'SUPPLIER_FINANCE_VIEW', 'Supplier ledger and balances'),
  (gen_random_uuid(), 'SUPPLIER_PAYMENT_MANAGE', 'Record invoices, payments, credits'),
  (gen_random_uuid(), 'ORDERS_VIEW', 'View orders'),
  (gen_random_uuid(), 'RECORD_COD_CONFIRMATION', 'Record phone COD confirmation'),
  (gen_random_uuid(), 'CONFIRM_ORDER', 'New → Confirmed'),
  (gen_random_uuid(), 'START_PREPARING', 'Confirmed → Preparing'),
  (gen_random_uuid(), 'MARK_READY_FOR_SHIPMENT', 'Preparing → Ready for Shipment'),
  (gen_random_uuid(), 'MARK_AS_SHIPPED', 'Ready for Shipment → Shipped'),
  (gen_random_uuid(), 'MARK_AS_DELIVERED', 'Record delivery (manual MVP)'),
  (gen_random_uuid(), 'CANCEL_ORDER', 'Cancel before carrier pickup (reason required)'),
  (gen_random_uuid(), 'REQUEST_SHIPPING_CANCELLATION', 'Shipping cancellation request after pickup'),
  (gen_random_uuid(), 'APPROVE_ORDER_STATUS_CHANGE', 'Approve pending order status requests'),
  (gen_random_uuid(), 'SHIPPING_VIEW', 'View carriers and shipping rules'),
  (gen_random_uuid(), 'SHIPPING_MANAGE', 'Edit carriers and shipping rules'),
  (gen_random_uuid(), 'ASSIGN_SHIPPING', 'Assign/change carrier on an order'),
  (gen_random_uuid(), 'MANAGE_SHIPMENT', 'Tracking numbers and shipment status updates'),
  (gen_random_uuid(), 'CONTACT_TASK_MANAGE', 'Work customer-contact tasks after failed deliveries'),
  (gen_random_uuid(), 'RETURNS_VIEW', 'View returns'),
  (gen_random_uuid(), 'APPROVE_RETURN', 'Approve / reject return requests'),
  (gen_random_uuid(), 'MANAGE_RETURNS', 'Arrange return pickup'),
  (gen_random_uuid(), 'RECEIVE_RETURN', 'Mark returned goods received'),
  (gen_random_uuid(), 'INSPECT_RETURN', 'Inspect returned items'),
  (gen_random_uuid(), 'COMPLETE_RETURN', 'Complete return and trigger the eligible wallet refund'),
  (gen_random_uuid(), 'RESOLVE_CUSTOMER_CAUSED_RETURN', 'Choose the R7 outcome (send back / keep + 25%)'),
  (gen_random_uuid(), 'MANAGE_MANUAL_REFUNDS', 'Alternative/manual refund methods'),
  (gen_random_uuid(), 'VIEW_WALLET_BALANCE', 'View a customer''s wallet'),
  (gen_random_uuid(), 'ADJUST_WALLET', 'Manual wallet adjustment'),
  (gen_random_uuid(), 'CUSTOMER_VIEW', 'Customer list and profile (name, order history)'),
  (gen_random_uuid(), 'VIEW_CUSTOMER_CONTACT', 'See customer phone and addresses'),
  (gen_random_uuid(), 'DISCOUNT_VIEW', 'View discounts'),
  (gen_random_uuid(), 'DISCOUNT_MANAGE', 'Manage discounts'),
  (gen_random_uuid(), 'MARKETING_VIEW', 'View campaign drafts'),
  (gen_random_uuid(), 'MARKETING_CREATE', 'Create campaign drafts'),
  (gen_random_uuid(), 'MARKETING_EDIT', 'Edit campaign drafts'),
  (gen_random_uuid(), 'MARKETING_APPROVE', 'Final campaign approval'),
  (gen_random_uuid(), 'MARKETING_SEND', 'Send an approved campaign'),
  (gen_random_uuid(), 'NOTIFICATION_LOG_VIEW', 'Notification delivery logs'),
  (gen_random_uuid(), 'ANALYTICS_VIEW', 'Analytics dashboards'),
  (gen_random_uuid(), 'VIEW_PROFIT', 'Profit and COGS figures'),
  (gen_random_uuid(), 'EMPLOYEE_VIEW', 'Employee list'),
  (gen_random_uuid(), 'EMPLOYEE_MANAGE', 'Invite, edit, deactivate employees within hierarchy limits'),
  (gen_random_uuid(), 'ROLE_VIEW', 'View roles'),
  (gen_random_uuid(), 'ROLE_MANAGE', 'Create/edit custom roles'),
  (gen_random_uuid(), 'APPROVAL_RESOLVE', 'Approve/reject approval requests'),
  (gen_random_uuid(), 'SETTINGS_VIEW', 'Read settings'),
  (gen_random_uuid(), 'SETTINGS_MANAGE', 'Change settings'),
  (gen_random_uuid(), 'VIEW_AUDIT_LOGS', 'Audit log viewer');
