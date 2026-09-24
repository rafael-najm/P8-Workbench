import { expect, test, type Page } from '@playwright/test';

async function open(page: Page) {
  await page.addInitScript(() => {
    const k = 'pico-workbench.settings';
    localStorage.setItem(k, JSON.stringify({ ...JSON.parse(localStorage.getItem(k) ?? '{}'), onboarded: true }));
  });
  await page.goto('/');
  await page.getByText('continue last cart').click();
  await page.waitForSelector('[data-testid=code-editor] .monaco-editor', { timeout: 30_000 });
}

/** Number of pixels of a given RGB in the game canvas. */
function countColor(page: Page, rgb: [number, number, number]) {
  return page.evaluate((c) => {
    const cv = document.querySelector<HTMLCanvasElement>('[data-testid=game-canvas]')!;
    const d = cv.getContext('2d')!.getImageData(0, 0, 128, 128).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] === c[0] && d[i + 1] === c[1] && d[i + 2] === c[2]) n++;
    return n;
  }, rgb);
}

test('open sample, run, edit a sprite, see it in the game', async ({ page }) => {
  await open(page);
  await expect(page.getByTestId('token-meter')).toContainText('5653');
  await page.getByTestId('run-button').click();
  await page.waitForTimeout(800);
  const pink = await countColor(page, [255, 119, 168]);
  // paint the whole title-screen ship sprites (1-3) pink with the fill tool
  await page.keyboard.press('Control+2');
  const sheet = page.getByTestId('sprite-sheet');
  await page.locator('[data-tool=rectfill]').click();
  await page.getByTestId('palette').locator('button').nth(14).click();
  for (const n of [1, 2, 3]) {
    const b = (await sheet.boundingBox())!;
    await page.mouse.click(b.x + n * 24 + 4, b.y + 4);
    const c = (await page.getByTestId('sprite-canvas').boundingBox())!;
    await page.mouse.move(c.x + 2, c.y + 2);
    await page.mouse.down();
    await page.mouse.move(c.x + c.width - 2, c.y + c.height - 2, { steps: 5 });
    await page.mouse.up();
  }
  await page.waitForTimeout(500);
  expect(await countColor(page, [255, 119, 168])).toBeGreaterThan(pink + 30);
});

test('agent edits code and runs the game (mocked OpenRouter)', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('pico-workbench.settings', JSON.stringify({ openrouterKey: 'sk-test', model: 'test/model' })));
  let step = 0;
  await page.route('https://openrouter.ai/api/v1/models', (r) => r.fulfill({ json: { data: [{ id: 'test/model', name: 'Test', supported_parameters: ['tools'], architecture: { input_modalities: ['text', 'image'] } }] } }));
  await page.route('https://openrouter.ai/api/v1/chat/completions', (r) => {
    step++;
    const chunk = (o: unknown) => `data: ${JSON.stringify(o)}\n\n`;
    const tool = (name: string, args: unknown) => chunk({ choices: [{ delta: { tool_calls: [{ index: 0, id: `c${step}`, function: { name, arguments: JSON.stringify(args) } }] }, finish_reason: 'tool_calls' }] });
    const body =
      step === 1 ? tool('edit_code', { old_str: 'hi=dget(0)', new_str: 'hi=dget(0) agent_was_here=42' })
      : step === 2 ? tool('run_game', { frames: 60, watch: ['agent_was_here'] })
      : chunk({ choices: [{ delta: { content: 'Added the variable and ran the game: no errors.' }, finish_reason: 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 10, cost: 0.0002 } });
    return r.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream' }, body: body + 'data: [DONE]\n\n' });
  });
  await open(page);
  await page.keyboard.press('Control+6');
  await page.getByTestId('agent-input').fill('add a variable');
  await page.getByTestId('agent-send').click();
  await expect(page.getByText('no errors.')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('tool-card')).toHaveCount(2);
  await expect(page.getByTestId('tool-card').nth(1)).toContainText('run_game');
  await page.getByTestId('tool-card').nth(1).click();
  await expect(page.getByTestId('agent-panel')).toContainText('"agent_was_here": 42');
  await expect(page.locator('.monaco-editor')).toContainText('agent_was_here=42');
});
