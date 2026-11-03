import { test, expect, type Page } from "@playwright/test";

// Send RFQ → vendor upload (via demo outbox link) → comparison → approve (2 levels) → PO.
// Requires a freshly seeded database and DEMO mode on.

async function login(page: Page, email: string) {
  await page.context().clearCookies();
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("nyati123");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/procurement");
}

async function vendorSubmits(page: Page, link: string, rate: number, days: number) {
  await page.goto(link);
  await expect(page.getByText("Request for quotation")).toBeVisible();
  await page.getByLabel("Your quotation").fill([`Quantity: 1000 bags`, `Unit Rate: Rs. ${rate} per bag`, "GST @ 28%", "Freight: Rs. 5,000", `Grand Total: Rs. ${(rate * 1000 * 1.28 + 5000).toFixed(2)}`, `Delivery within ${days} days`, "Payment terms: 30 days credit", "Validity: 15 days"].join("\n"));
  await page.getByLabel(/Unit rate/).fill(String(rate));
  await page.getByRole("button", { name: "Submit Quotation" }).click();
  await expect(page.getByText("Quotation submitted")).toBeVisible();
}

test("RFQ to PO happy path", async ({ page }) => {
  await login(page, "buyer@nyati.in");
  await page.getByRole("button", { name: /Create RFQ for PPC Cement/ }).click();
  await page.getByLabel(/Quantity \(bag\)/).fill("1000");
  await page.getByRole("button", { name: /Next: select vendors/ }).click();
  await expect(page.getByText("Best fit")).toBeVisible();
  await page.getByRole("button", { name: "Send RFQ" }).click();
  await page.getByRole("button", { name: "Send RFQ" }).last().click();
  await expect(page.getByText(/sent$/)).toBeVisible();
  await page.getByRole("link", { name: "Open RFQ" }).click();
  const rfqUrl = page.url();

  const links = await page.getByRole("link", { name: "Open vendor portal" }).evaluateAll((els) => els.map((e) => (e as HTMLAnchorElement).href));
  expect(links.length).toBeGreaterThanOrEqual(2);
  const vendor = await page.context().newPage();
  await vendorSubmits(vendor, links[0], 355, 3);
  await vendorSubmits(vendor, links[1], 349, 4);
  await vendor.close();

  await page.goto(`${rfqUrl}?tab=comparison`);
  await expect(page.getByText(/Recommended vendor:/)).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Send for approval" }).first().click();
  await page.getByRole("button", { name: "Send for approval" }).last().click();
  await expect(page.getByText("Approval request")).toBeVisible();

  for (const approver of ["approver@nyati.in", "finance@nyati.in"]) {
    await login(page, approver);
    await page.goto(`${rfqUrl}?tab=approval`);
    await page.getByRole("button", { name: /^Approve/ }).first().click();
    await page.getByRole("button", { name: "Approve" }).last().click();
    await expect(page.getByText("Decision recorded")).toBeVisible();
  }
  await page.goto(rfqUrl);
  await expect(page.getByRole("link", { name: /PO-PNQ1-/ })).toBeVisible();
});
