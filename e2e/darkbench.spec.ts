import { expect, test, type Page } from "@playwright/test";

const dismissNewsletter = (page: Page) =>
  page.getByRole("dialog").getByRole("button", { name: /not now|no, i hate/i }).click();

async function buyCable(page: Page, { nagged = false } = {}) {
  await page.goto("/product/usb-cable/");
  if (nagged) await dismissNewsletter(page);
  await page.getByRole("button", { name: "Add to cart" }).click();
  await expect(page).toHaveURL(/\/cart\/$/);
}

test("clean variant: honest prices, guest checkout, no planted patterns", async ({ page }) => {
  await page.goto("/?v=0");
  await dismissNewsletter(page);
  await expect(page.getByText("Sponsored")).toBeVisible();

  await buyCable(page);
  await expect(page.getByRole("dialog")).toContainText("Protect your purchase?");
  await page.getByRole("button", { name: "No thanks" }).click();
  const cartTotal = await page.getByTestId("order-total").textContent();

  await page.getByRole("link", { name: "Proceed to checkout" }).click();
  await page.getByRole("button", { name: "Continue as guest" }).click();
  await expect(page.getByTestId("order-total")).toHaveText(cartTotal!);
  await expect(page.getByTestId("checkout-items")).not.toContainText("Purchase Protection");
  await expect(page.getByRole("checkbox")).not.toBeChecked();
});

test("all-patterns variant: every planted pattern shows up", async ({ page }) => {
  await page.goto("/?v=1");
  await page.getByRole("button", { name: "No, I hate saving money" }).click();
  await expect(page.getByText("Sponsored")).toHaveCount(0); // disguised ads

  await page.goto("/product/earbuds-lite/");
  await expect(page.getByText("Currently unavailable")).toBeVisible(); // bait and switch
  await expect(page.getByRole("dialog")).toBeVisible(); // nagging: popup is back on a new page
  await dismissNewsletter(page);

  await buyCable(page, { nagged: true });
  await dismissNewsletter(page);
  await expect(page.getByRole("button", { name: "No thanks, I'll risk breaking it" })).toHaveClass(/btn-faint/);
  await page.getByRole("button", { name: "No thanks, I'll risk breaking it" }).click();
  const cartTotal = await page.getByTestId("order-total").textContent();

  await page.getByRole("link", { name: "Proceed to checkout" }).click();
  await dismissNewsletter(page);
  await expect(page.getByRole("button", { name: "Continue as guest" })).toHaveCount(0); // forced action
  await page.getByPlaceholder("Email").fill("bench@example.com");
  await page.getByPlaceholder("Password").fill("bench-only");
  await page.getByRole("button", { name: "Create account" }).click();

  await expect(page.getByTestId("checkout-items")).toContainText("Purchase Protection"); // basket sneaking
  await expect(page.getByTestId("order-summary")).toContainText("Convenience fee"); // drip pricing
  expect(await page.getByTestId("order-total").textContent()).not.toBe(cartTotal);
  await expect(page.getByRole("checkbox")).toBeChecked(); // trick question
});

test("false urgency timer restarts on reload", async ({ page }) => {
  await page.goto("/?dp=false_urgency");
  await page.getByRole("button", { name: "Not now" }).click();
  await page.goto("/product/speaker/");
  await expect(page.getByText("Only 2 left in stock!")).toBeVisible();
  await page.waitForTimeout(2100);
  await expect(page.locator(".timer")).not.toHaveText("10:00");
  await page.reload();
  await expect(page.locator(".timer")).toHaveText(/^(10:00|09:59)$/);
});
