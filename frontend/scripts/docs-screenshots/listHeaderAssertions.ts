import { expect, type Page } from "@playwright/test";

/** Shared rendered contract, independent of table data or workspace language. */
export async function assertListHeaders(page: Page, { singleLine = false }: { singleLine?: boolean } = {}) {
  const toolbars = page.locator('.ui-list-toolbar[data-list-variant]:visible');
  for (const toolbar of await toolbars.all()) {
    await expect(toolbar).toHaveAccessibleName(/.+/);
    const heading = toolbar.locator(".ui-list-toolbar-heading");
    if (await toolbar.getAttribute("data-list-variant") === "page") await expect(heading).toHaveCount(0);
    else await expect(heading.locator("h2")).toBeVisible();
    const controls = toolbar.locator('.ui-list-toolbar-body');
    if (!await controls.count()) continue;
    const geometry = await controls.evaluate((body) => {
      const visible = (element: Element) => element.getBoundingClientRect().width > 0 && element.getBoundingClientRect().height > 0;
      return {
        order: [...body.children].map(child => child.className),
        centers: [...body.querySelectorAll('input:not([type="checkbox"]), textarea, select, button, .ui-list-toolbar-count')]
          .filter(visible).map(element => { const rect = element.getBoundingClientRect(); return rect.top + rect.height / 2; }),
        searchPadding: [...body.querySelectorAll('.ui-list-toolbar-search input, .ui-list-toolbar-search textarea')]
          .map(input => parseFloat(getComputedStyle(input).paddingLeft)),
        labels: [...body.querySelectorAll('.ui-list-toolbar-filters .ui-field-label')]
          .filter(visible).map(label => getComputedStyle(label).textTransform),
      };
    });
    const expectedOrder = ['ui-list-toolbar-search', 'ui-list-toolbar-filters', 'ui-list-toolbar-tools', 'ui-list-toolbar-count'];
    expect(geometry.order).toEqual(expectedOrder.filter(name => geometry.order.includes(name)));
    expect(geometry.searchPadding.every(padding => padding >= 28)).toBe(true);
    expect(geometry.labels.every(transform => transform === "none")).toBe(true);
    if (singleLine && geometry.centers.length > 1) {
      expect(Math.max(...geometry.centers) - Math.min(...geometry.centers), JSON.stringify(geometry)).toBeLessThanOrEqual(2);
    }
    for (const search of await toolbar.locator('.ui-list-toolbar-search :is(input, textarea)').all()) {
      await expect(search).toHaveAccessibleName(/.+/);
    }
  }
}
