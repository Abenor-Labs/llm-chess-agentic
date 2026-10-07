import { test, expect, type Page } from "@playwright/test";

/**
 * Full-stack flows against a real server and database (no mocked APIs). Uses
 * the built-in engines so no provider keys are needed. Runs serially: the arena
 * allows one live game at a time.
 */
test.describe.configure({ mode: "serial" });

async function stopAnyLiveGame(page: Page) {
  await page.request.post("/api/games/destroy", { data: {} });
}

test.beforeEach(async ({ page }) => {
  await stopAnyLiveGame(page);
});

test.afterAll(async ({ request }) => {
  await request.post("/api/games/destroy", { data: {} });
});

test("plays a live engine match: moves stream in, navigation and stopping work", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await page.goto("/");
  await page.getByTestId("quick-engines").click();
  await expect(page.getByTestId("setup-white").getByRole("option", { selected: true })).toContainText("Arena Engine (depth 2)");
  await page.getByTestId("start-match").click();

  // The game screen replaces setup and moves arrive.
  await expect(page.getByTestId("status-strip")).toBeVisible();
  await expect.poll(async () => page.getByTestId("move-list-item").count(), { timeout: 30_000 }).toBeGreaterThan(3);
  await expect(page.getByTestId("live-indicator")).toBeVisible();

  // Keyboard navigation moves the board and the counter.
  await page.keyboard.press("Home");
  await expect(page.getByTestId("ply-counter")).toContainText(/^0 \//);
  await expect(page.getByTestId("board")).toHaveAttribute("data-fen", /^rnbqkbnr\/pppppppp/);
  await page.keyboard.press("ArrowRight");
  await expect(page.getByTestId("ply-counter")).toContainText(/^1 \//);
  await expect(page.getByTestId("focus-move").first()).toBeVisible();

  // Clicking a move in the list jumps there.
  await page.getByTestId("move-list-item").nth(2).click();
  await expect(page.getByTestId("ply-counter")).toContainText(/^3 \//);

  // Stop the match (if it hasn't already finished): it ends without a result.
  page.once("dialog", (d) => d.accept());
  const stop = page.getByTestId("stop-match");
  if (await stop.isVisible()) await stop.click();
  await expect(page.getByTestId("result-banner")).toBeVisible({ timeout: 30_000 });

  expect(errors).toEqual([]);
});

test("finished games appear in history and open for replay", async ({ page, request }) => {
  const res = await request.post("/api/games/start", { data: { modelIds: ["local/greedy", "local/random"] } });
  expect(res.ok()).toBeTruthy();
  const { gameId } = await res.json();
  // Drive it to the end server-side.
  for (let i = 0; i < 40; i++) {
    const g = await (await request.get(`/api/games/${gameId}`)).json();
    if (g.game.status !== "active") break;
    await request.post("/api/cron/tick");
  }
  await stopAnyLiveGame(page); // in case it's still going after 40 ticks

  await page.goto("/games");
  const card = page.locator(`a[href="/game/${gameId}"]`);
  await expect(card).toBeVisible();
  await card.click();
  await expect(page).toHaveURL(new RegExp(`/game/${gameId}$`));
  await expect(page.getByTestId("result-banner")).toBeVisible();
  await expect(page.getByTestId("side-panel-white")).toContainText("Greedy Grabber");
  await expect(page.getByTestId("side-panel-black")).toContainText("Random Mover");
});

test("an LLM match without a key is caught before anything is created", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("pick-white-groq/openai/gpt-oss-120b").click();
  await page.getByTestId("pick-black-local/random").click();
  await expect(page.getByText(/Needs your Groq key/)).toBeVisible();
  await page.getByTestId("start-match").click();
  await expect(page.getByRole("dialog", { name: "Settings" })).toBeVisible();
  await expect(page.getByTestId("start-error")).toContainText("Add your Groq API key first");

  // Saving a key is remembered in the browser and clears the warning.
  await page.getByTestId("key-input-groq").fill("gsk_test_1234567890");
  await page.getByTestId("key-save-groq").click();
  await expect(page.getByText("Saved · gsk_…7890")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByText(/Needs your Groq key/)).toBeHidden();
  expect(await page.evaluate(() => localStorage.getItem("groqApiKey"))).toBe("gsk_test_1234567890");

  // A model can't face itself: it's disabled on the other side.
  await expect(page.getByTestId("pick-black-groq/openai/gpt-oss-120b")).toBeDisabled();
});

test("leaderboard renders ratings", async ({ page }) => {
  await page.goto("/leaderboard");
  await page.getByLabel("Show unplayed models").check();
  await expect(page.getByTestId("leaderboard-table")).toContainText("Arena Engine (depth 4)");
});
