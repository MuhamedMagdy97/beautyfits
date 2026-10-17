import { expect, test } from "@playwright/test";
import { englishContext, fillAddress } from "./helpers";

// Guest browse → product → bag → cash-on-delivery checkout → confirmation
// (User Flows §6.2, API "TASK-029 Amendments").
test("a guest buys a product with cash on delivery", async ({ browser }) => {
  const context = await englishContext(browser);
  const page = await context.newPage();

  await page.goto("/products");
  const search = page.getByRole("main").getByRole("searchbox", { name: "Search" });
  await search.fill("Velvet Matte Lipstick");
  await search.press("Enter");
  await page
    .getByRole("link", { name: /Velvet Matte Lipstick/ })
    .first()
    .click();
  await expect(page.getByRole("heading", { name: "Velvet Matte Lipstick" })).toBeVisible();
  await page.getByRole("button", { name: "Add to bag" }).click();
  await expect(page.getByText("Added to your bag.")).toBeVisible();

  await page.getByRole("link", { name: "View bag" }).click();
  await expect(page.getByText("Velvet Matte Lipstick").first()).toBeVisible();
  await page.getByRole("link", { name: "Proceed to checkout" }).click();

  await page.locator('input[name="fullName"]').fill("Guest Shopper");
  await page.locator('input[name="contactPhone"]').fill("01112345678");
  await fillAddress(page, "Guest Shopper");
  await page.getByRole("button", { name: "Review order" }).click();
  await page.getByRole("button", { name: "Place order" }).click();

  await expect(page.getByRole("heading", { name: "Thank you for your order" })).toBeVisible();
  await expect(page.getByText("Order number")).toBeVisible();
  await expect(page.getByText(/We will ask you to confirm the order/)).toBeVisible();
  await expect(page.getByText(/Guest orders cannot be tracked online/)).toBeVisible();
  await context.close();
});
