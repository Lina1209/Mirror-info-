import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const pageErrors = [];
page.on('pageerror', error => pageErrors.push(error.message));

try {
  await page.goto('http://127.0.0.1:4173/tests/pdf-merge-compatibility.html', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForFunction(() => Boolean(window.jspdf && window.PDFLib && window.pdfjsLib), null, { timeout: 60000 });
  await page.getByRole('button', { name: 'Запустить тест' }).click();
  await page.getByText(/RESULT: (PASS|FAIL)/).waitFor({ timeout: 60000 });
  const output = await page.locator('#log').innerText();
  console.log(output);
  if (!output.includes('RESULT: PASS')) throw new Error('PDF compatibility harness reported failure');
  if (pageErrors.length) throw new Error('Browser page errors: ' + pageErrors.join('; '));
} finally {
  await browser.close();
}
