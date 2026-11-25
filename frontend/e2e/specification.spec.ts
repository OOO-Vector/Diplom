import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";

test("registers, creates a project and keeps the latest specification after reload", async ({
  page,
}) => {
  const email = `playwright-${randomUUID()}@example.test`;
  const password = "playwright fixture password";
  await page.goto("/");
  await page.getByRole("link", { name: "Create an account" }).click();
  await page.getByLabel("Display name").fill("Playwright user");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Register" }).click();

  if (process.env.E2E_BACKEND_URL) {
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign in" }).click();
  }
  await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();
  await page.getByRole("button", { name: "New project" }).click();
  const sidebar = page.getByRole("complementary", { name: "Projects" });
  await sidebar
    .getByRole("textbox", { name: "Project name" })
    .fill("Test project");
  await sidebar.getByRole("button", { name: "Create project" }).click();
  if (!process.env.E2E_BACKEND_URL)
    await page.getByRole("link", { name: "Tasks", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Project tasks" }),
  ).toBeVisible();

  const picker = page.locator('input[aria-label="Project document"]');
  for (const name of ["requirements-v1.txt", "requirements-v2.txt"]) {
    await picker.setInputFiles({
      name,
      mimeType: "text/plain",
      buffer: Buffer.from("# Project\nBuild the workspace."),
    });
    await expect(page.getByText(`Loaded file: ${name}`)).toBeVisible();
  }

  await page.reload();
  await expect(
    page.getByText("Loaded file: requirements-v2.txt"),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Decompose into tasks" }),
  ).toBeVisible();

  await page.getByRole("link", { name: "Profile" }).click();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
});
