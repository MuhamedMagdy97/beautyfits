import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { CARRIER } from "./config";
import { apiGet, apiPost, englishContext, fillAddress, readOtp, staffSignIn } from "./helpers";

// One customer order from registration to a wallet refund (TASK-063):
// customer checkout → order list/detail → staff confirm, prepare, ship,
// deliver → customer return request → staff approve, pickup, receive,
// inspect, assess, complete → wallet credited. Steps share state, so serial.
test.describe.configure({ mode: "serial" });

const customer = {
  fullName: "E2E Customer",
  email: `e2e.customer.${Date.now()}@beautyfits.example`,
  phone: "01512345678",
  password: "e2e-customer-passphrase-1",
};

let shop: BrowserContext;
let staff: BrowserContext;
let shopPage: Page;
let staffPage: Page;
let orderId = "";
let orderNumber = "";
let returnId = "";

test.beforeAll(async ({ browser }) => {
  shop = await englishContext(browser);
  staff = await englishContext(browser);
  shopPage = await shop.newPage();
  staffPage = await staff.newPage();
});

test.afterAll(async () => {
  await shop?.close();
  await staff?.close();
});

test("customer registers with the emailed code", async () => {
  const page = shopPage;
  await page.goto("/register");
  await page.getByLabel("Full name").fill(customer.fullName);
  await page.getByLabel("Email").fill(customer.email);
  await page.getByLabel("Mobile number").fill(customer.phone);
  await page.getByLabel("Password").fill(customer.password);
  const since = Date.now();
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Email code").fill(await readOtp(customer.email, since));
  await page.getByRole("button", { name: "Verify" }).click();
  await expect(page).not.toHaveURL(/\/register/);
});

test("customer checks out a product with cash on delivery", async () => {
  const page = shopPage;
  await page.goto("/products");
  const search = page.getByRole("main").getByRole("searchbox", { name: "Search" });
  await search.fill("Silk Lip Gloss");
  await search.press("Enter");
  await page
    .getByRole("link", { name: /Silk Lip Gloss/ })
    .first()
    .click();
  await page.getByRole("button", { name: "Add to bag" }).click();
  await expect(page.getByText("Added to your bag.")).toBeVisible();
  await page.goto("/checkout");
  await fillAddress(page, customer.fullName);
  await page.getByRole("button", { name: "Review order" }).click();
  await page.getByRole("button", { name: "Place order" }).click();
  await expect(page.getByRole("heading", { name: "Thank you for your order" })).toBeVisible();
});

test("customer signs in and sees the order in the list and detail", async ({ browser }) => {
  // A fresh browser: sign in with the password.
  const context = await englishContext(browser);
  const page = await context.newPage();
  await page.goto("/login");
  await page.getByLabel("Email").fill(customer.email);
  await page.getByLabel("Password").fill(customer.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).not.toHaveURL(/\/login/);

  await page.goto("/account/orders");
  await expect(page.getByText("Awaiting your confirmation")).toBeVisible();
  await page.getByRole("link", { name: /Awaiting your confirmation/ }).click();
  await expect(page).toHaveURL(/\/account\/orders\/[0-9a-f-]{36}$/);
  orderId = page.url().split("/").at(-1)!;
  orderNumber = (await page.locator("h2").first().textContent())!.trim();
  await expect(page.getByText("Silk Lip Gloss").first()).toBeVisible();
  await context.close();
});

test("staff sign in with the emailed code and take the order to delivered", async () => {
  const page = staffPage;
  await staffSignIn(page);
  await page.goto(`/staff/orders/${orderId}`);
  await expect(page.getByRole("heading", { name: orderNumber })).toBeVisible();

  // Phone confirmation; the System then moves the order to New (R1, R10).
  for (const step of [
    "Record phone confirmation",
    "Confirm order",
    "Start preparing",
    "Ready for shipment",
  ]) {
    await page.getByRole("button", { name: step }).click();
    await expect(page.getByRole("button", { name: step })).toBeHidden();
  }

  await page.getByLabel("Carrier").selectOption({ label: CARRIER.name });
  await page.getByRole("button", { name: "Assign carrier" }).click();
  await expect(page.getByText(CARRIER.name).first()).toBeVisible();
  await page.getByLabel("Tracking number (optional)").fill("E2E-TRACK-1");
  await page.getByRole("button", { name: "Hand over to carrier" }).click();
  await expect(page.getByRole("button", { name: "Hand over to carrier" })).toBeHidden();

  await page.goto(`/staff/shipping/orders/${orderId}`);
  // The status form offers the next statuses, and goes away once delivered.
  await page.getByLabel("New status").selectOption("OUT_FOR_DELIVERY");
  await page.getByRole("button", { name: "Update status" }).click();
  await expect(page.getByLabel("New status")).toHaveValue("DELIVERED");
  await page.getByRole("button", { name: "Update status" }).click();
  await expect(page.getByRole("button", { name: "Update status" })).toBeHidden();
  const order = await apiGet<{ status: string }>(page, `/api/v1/admin/orders/${orderId}`);
  expect(order.status).toBe("DELIVERED");
});

test("customer requests a return of the delivered order", async () => {
  const page = shopPage;
  await page.goto(`/account/orders/${orderId}`);
  await expect(page.getByText("Delivered").first()).toBeVisible();
  await page.getByRole("button", { name: "Request a return" }).click();
  await page.getByLabel("What is the problem?").selectOption("OTHER");
  await page.getByRole("checkbox").first().check();
  await page.getByLabel("Tell us what happened").fill("Not the shade I expected.");
  await page.getByRole("button", { name: "Send return request" }).click();
  await expect(page).toHaveURL(/\/account\/returns\/[0-9a-f-]{36}$/);
  returnId = page.url().split("/").at(-1)!;
  await expect(page.getByText("Waiting for review")).toBeVisible();
});

test("staff approve, collect, receive, inspect and complete the return", async () => {
  const page = staffPage;
  page.on("dialog", (dialog) => void dialog.accept());
  await page.goto(`/staff/returns/${returnId}`);

  await page.getByRole("button", { name: "Approve" }).click();
  await page.getByLabel("Carrier").selectOption({ label: CARRIER.name });
  await page.getByRole("button", { name: "Request pickup" }).click();
  await page.getByRole("button", { name: "Mark received" }).click();
  await page.getByRole("button", { name: "Start inspection" }).click();
  // Default outcome: every requested unit restocked as sellable.
  await page.getByRole("button", { name: "Save inspection" }).click();
  await expect(page.getByRole("button", { name: "Save inspection" })).toBeHidden();

  // The assessment has no screen yet (TASK-040): the API, from the staff session.
  await apiPost(page, `/api/v1/admin/returns/${returnId}/assessment`, {
    finalResponsibility: "BEAUTYFITS",
  });
  await page.reload();
  await page.getByRole("button", { name: "Complete and refund to wallet" }).click();
  await expect(page.getByRole("button", { name: "Complete and refund to wallet" })).toBeHidden();

  const done = await apiGet<{ status: string }>(page, `/api/v1/admin/returns/${returnId}`);
  expect(done.status).toBe("COMPLETED");
});

test("the refund is in the customer's wallet", async () => {
  const page = shopPage;
  const order = await apiGet<{ total: number }>(page, `/api/v1/orders/${orderId}`);
  // BeautyFits responsible, everything restocked: the product and the delivery fee (ADR-0066).
  const wallet = await apiGet<{ available: number }>(page, "/api/v1/me/wallet");
  expect(wallet.available).toBe(order.total);

  await page.goto("/account/wallet");
  await expect(page.getByText("Return refund")).toBeVisible();
  await page.goto(`/account/returns/${returnId}`);
  await expect(page.getByText("Completed")).toBeVisible();
});
