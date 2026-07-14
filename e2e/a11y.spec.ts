import AxeBuilder from '@axe-core/playwright'
import { expect, type Page, test } from '@playwright/test'

/** Serious/critical WCAG 2.x A/AA violations, as readable strings (empty = pass).
 *  `include` scopes the scan to a selector (e.g. an open dialog, so the dimmed
 *  page behind its overlay doesn't skew axe's contrast math). */
async function violations(page: Page, include?: string): Promise<string[]> {
  let builder = new AxeBuilder({ page }).withTags([
    'wcag2a',
    'wcag2aa',
    'wcag21a',
    'wcag21aa',
  ])
  // color-contrast IS enforced: the redesign dropped `backdrop-filter`, so axe
  // can resolve the (opaque) panel backgrounds and measure contrast for real.
  if (include) builder = builder.include(include)
  const results = await builder.analyze()
  return results.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .flatMap((v) => v.nodes.map((n) => `${v.id}: ${n.target.join(' ')}`))
}

test('the send home has no serious a11y violations (both themes)', async ({
  page,
}) => {
  await page.goto('/')
  await expect(
    page.getByRole('heading', { name: /send a file/i }),
  ).toBeVisible()
  // Scan the default theme (dark), then flip and scan the other (light).
  expect(await violations(page)).toEqual([])

  const toggle = page.getByRole('button', { name: /switch to/i })
  const before = await toggle.getAttribute('aria-label')
  await toggle.click()
  // The toggle's label flips once the theme actually changed — wait on that.
  await expect(toggle).not.toHaveAttribute('aria-label', before ?? '')
  expect(await violations(page)).toEqual([])
})

test('the receive-by-code screen has no serious a11y violations', async ({
  page,
}) => {
  await page.goto('/')
  await page.getByTestId('go-receive').click()
  await expect(page.getByTestId('code-input')).toBeVisible()
  expect(await violations(page)).toEqual([])
})

test('the "how it works" dialog is accessible and closes', async ({ page }) => {
  await page.goto('/')
  await page.getByTestId('help').click()
  const dialog = page.getByRole('dialog', { name: /how it works/i })
  await expect(dialog).toBeVisible()
  expect(await violations(page, '[role="dialog"]')).toEqual([])
  // Escape closes it.
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
})
