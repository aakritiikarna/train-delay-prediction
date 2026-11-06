// MANUAL smoke test (not part of `npm test`). Needs: running app on :3111 + ML service, seeded with SEED_DEMO_USERS=true,
// DEMO_PASSWORD=Demo-Pass-123, ADMIN_EMAIL=admin@example.com, ADMIN_PASSWORD=Smoke-Pass-123, and `npm i -D playwright`.
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext(); const page = await ctx.newPage();
  const problems = []; let dialogs = 0;
  page.on('console', m => { if (['error','warning'].includes(m.type())) problems.push(`[${page.url().replace('http://localhost:3111','')}] ${m.text()}`); });
  page.on('pageerror', e => problems.push('pageerror ' + e.message));
  page.on('dialog', d => { dialogs++; d.dismiss(); });
  const base = 'http://localhost:3111';
  for (const p of ['/', '/passenger', '/contact', '/login']) { await page.goto(base + p); await page.waitForTimeout(700); }
  // passenger widgets
  await page.goto(base + '/passenger'); await page.waitForTimeout(1200);
  console.log('passenger stats:', await page.locator('#statDisruptions').innerText(), '| trains rows:', await page.locator('#trainsBody tr').count(), '| alerts:', await page.locator('#alertsList .alert-item').count());
  await page.click('#predictBtn'); await page.waitForSelector('#delayVal'); await page.waitForTimeout(1500);
  console.log('prediction shown:', await page.locator('#delayVal').innerText());
  // anonymous -> controller redirects
  await page.goto(base + '/controller'); console.log('anon /controller ->', new URL(page.url()).pathname + new URL(page.url()).search);
  // login as controller
  await page.fill('#lEmail', 'controller@traintrack.test'); await page.fill('#lPassword', 'Demo-Pass-123'); await page.click('#loginForm button[type=submit]');
  await page.waitForURL('**/controller', { timeout: 8000 }); await page.waitForTimeout(1500);
  console.log('controller landed:', page.url().replace(base,''), '| active disruptions rows:', await page.locator('#disruptBody tr').count(), '| schedule rows:', await page.locator('#scheduleBody tr').count());
  // XSS payload
  await page.fill('#trainId', '<img src=x onerror=alert(1)>'); await page.fill('#estDelay', '9'); await page.click('#logForm button[type=submit]');
  await page.waitForTimeout(1500);
  console.log('XSS: dialogs fired =', dialogs, '| payload rendered as text =', (await page.locator('#disruptBody').innerText()).includes('<img src=x onerror=alert(1)>'), '| injected <img> elements in table =', await page.locator('#disruptBody img').count());
  // edit schedule
  await page.locator('#scheduleBody button').first().click(); await page.fill('#editDelay', '12'); await page.selectOption('#editStatus', 'Delayed'); await page.click('#editSave'); await page.waitForTimeout(1000);
  console.log('edit dialog closed:', !(await page.locator('#editDialog').evaluate(d => d.open)));
  await page.goto(base + '/admin'); console.log('controller /admin ->', new URL(page.url()).pathname);
  await page.goto(base + '/login'); await page.evaluate(() => fetch('/api/auth/logout', { method: 'POST' }));
  await page.reload(); await page.fill('#lEmail', 'admin@example.com'); await page.fill('#lPassword', 'Smoke-Pass-123'); await page.click('#loginForm button[type=submit]');
  await page.waitForURL('**/admin'); await page.waitForTimeout(1500);
  console.log('admin users rows:', await page.locator('#userBody tr').count(), '| audit rows:', await page.locator('#auditBody tr').count(), '| totalUsers:', await page.locator('#totalUsers').innerText());
  await page.setViewportSize({ width: 375, height: 800 }); await page.goto(base + '/passenger'); await page.waitForTimeout(800);
  console.log('mobile horizontal overflow:', await page.evaluate(() => document.documentElement.scrollWidth > innerWidth));
  console.log('\nCONSOLE/CSP PROBLEMS:', problems.length ? '\n' + problems.join('\n') : 'none');
  await b.close();
})().catch(e => { console.error('SMOKE FAILED', e.message); process.exit(1); });
