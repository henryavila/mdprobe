import { test, expect } from '@playwright/test'
import { startServer, stopServer } from './helpers/server.js'

let ctx

test.beforeAll(async () => {
  ctx = await startServer({ files: ['sample.md'], withAnnotations: false })
})

test.afterAll(async () => {
  await stopServer(ctx)
})

/**
 * Helper: programmatically select text inside an element containing `textSnippet`,
 * then dispatch mouseup on .content-area so the popover appears.
 */
async function selectTextAndTriggerPopover(page, textSnippet) {
  await page.evaluate((snippet) => {
    // Find the li element containing the snippet text
    const allLis = document.querySelectorAll('.content-area li')
    let el = null
    for (const li of allLis) {
      if (li.textContent.includes(snippet)) {
        el = li
        break
      }
    }
    if (!el) throw new Error(`Element with text "${snippet}" not found`)
    const range = document.createRange()
    range.selectNodeContents(el)
    const selection = window.getSelection()
    selection.removeAllRanges()
    selection.addRange(range)
    // Dispatch mouseup on the content area to trigger the popover logic
    const contentArea = document.querySelector('.content-area')
    contentArea.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
  }, textSnippet)
}

test.describe('Annotation CRUD', () => {
  test('full lifecycle — create → edit → resolve → reopen → delete', async ({ page }) => {
    await page.goto(ctx.url)
    await expect(page.locator('.content-area h1')).toContainText('Sample Spec')

    // --- CREATE ---
    // Select the "telefone sem validação no MVP" list item text
    await selectTextAndTriggerPopover(page, 'telefone sem validação')

    // Popover should appear
    const popover = page.locator('.popover')
    await expect(popover).toBeVisible({ timeout: 5000 })

    // Textarea should be focused — type directly
    const textarea = popover.locator('textarea')
    await expect(textarea).toBeVisible()

    // Select bug tag
    await popover.locator('.tag-pill--bug').click()

    // Type comment and save with Ctrl+Enter
    await textarea.fill('Missing phone validation')
    await textarea.press('Control+Enter')

    // Popover should close
    await expect(popover).not.toBeVisible({ timeout: 5000 })

    // Annotation card appears in right panel
    const card = page.locator('.annotation-card').first()
    await expect(card).toBeVisible({ timeout: 5000 })
    await expect(card).toContainText('Missing phone validation')

    // Highlight appears in content
    await expect(page.locator('mark[data-highlight-id]').first()).toBeVisible({ timeout: 5000 })

    // --- RESOLVE ---
    // First enable "Show resolved" so the card stays visible after resolving
    const showResolvedCheckbox = page.locator('.right-panel input[type="checkbox"]')
    await showResolvedCheckbox.check()

    await card.click()
    await expect(card).toHaveClass(/selected/)

    // Click Resolve button
    await card.locator('button:has-text("Resolve")').click()

    // Wait for card to get resolved class
    const resolvedCard = page.locator('.annotation-card.resolved')
    await expect(resolvedCard).toBeVisible({ timeout: 5000 })

    // --- REOPEN ---
    await resolvedCard.click()
    await expect(resolvedCard).toHaveClass(/selected/)
    await resolvedCard.locator('button:has-text("Reopen")').click()

    // Card should no longer be resolved
    const openCard = page.locator('.annotation-card').first()
    await expect(openCard).toBeVisible({ timeout: 5000 })
    await expect(openCard).not.toHaveClass(/resolved/, { timeout: 5000 })

    // --- EDIT ---
    await openCard.click()
    await expect(openCard).toHaveClass(/selected/)
    await openCard.locator('button:has-text("Edit")').click()

    // Edit form appears inside the card
    const editForm = openCard.locator('.annotation-form')
    await expect(editForm).toBeVisible({ timeout: 5000 })

    const editTextarea = editForm.locator('textarea')
    await editTextarea.fill('Updated: phone validation needed')
    await editTextarea.press('Control+Enter')

    // Verify updated comment
    await expect(openCard).toContainText('Updated: phone validation needed', { timeout: 5000 })

    // --- DELETE ---
    // Set up dialog handler before clicking delete
    page.on('dialog', dialog => dialog.accept())
    await openCard.click()
    await expect(openCard).toHaveClass(/selected/)
    await openCard.locator('button:has-text("Delete")').click()

    // Card should disappear
    await expect(page.locator('.annotation-card')).toHaveCount(0, { timeout: 5000 })
  })

  test('popover closes on Escape', async ({ page }) => {
    await page.goto(ctx.url)
    await expect(page.locator('.content-area h1')).toContainText('Sample Spec')

    // Select text
    await selectTextAndTriggerPopover(page, 'email validado')

    const popover = page.locator('.popover')
    await expect(popover).toBeVisible({ timeout: 5000 })

    // Press Escape
    await page.keyboard.press('Escape')
    await expect(popover).not.toBeVisible({ timeout: 3000 })
  })

  test('reply to annotation', async ({ page }) => {
    await page.goto(ctx.url)
    await expect(page.locator('.content-area h1')).toContainText('Sample Spec')

    // Create an annotation first
    await selectTextAndTriggerPopover(page, 'nome com mínimo')

    const popover = page.locator('.popover')
    await expect(popover).toBeVisible({ timeout: 5000 })

    const textarea = popover.locator('textarea')
    await textarea.fill('Check min length')
    await textarea.press('Control+Enter')
    await expect(popover).not.toBeVisible({ timeout: 5000 })

    // Card appears
    const card = page.locator('.annotation-card').first()
    await expect(card).toBeVisible({ timeout: 5000 })

    // Select card to show reply input
    await card.click()
    await expect(card).toHaveClass(/selected/)

    // Type reply
    const replyInput = card.locator('.reply-input input')
    await expect(replyInput).toBeVisible()
    await replyInput.fill('Confirmed: 3 chars minimum')
    await card.locator('.reply-input button').click()

    // Reply text should appear in the card
    await expect(card).toContainText('Confirmed: 3 chars minimum', { timeout: 5000 })
  })
})
