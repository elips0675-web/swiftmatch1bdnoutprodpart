import { chromium } from '@playwright/test';

const URL = 'http://localhost:8081';
const API  = 'http://localhost:3002';

const PAGES = [
  { path: '/',                     name: 'Main' },
  { path: '/login',                name: 'Login' },
  { path: '/register',             name: 'Register' },
  { path: '/forgot-password',      name: 'ForgotPassword' },
  { path: '/premium',              name: 'Premium' },
  { path: '/premium/success',      name: 'PremiumSuccess' },
  { path: '/premium/cancel',       name: 'PremiumCancel' },
  { path: '/xxxx-non-existent',    name: '404' },
  { path: '/search',               name: 'Search',        needAuth: true },
  { path: '/matches',              name: 'Matches',       needAuth: true },
  { path: '/chats',                name: 'Chats',         needAuth: true },
  { path: '/profile/2',            name: 'Profile',       needAuth: true },
  { path: '/profile/edit',         name: 'ProfileEdit',   needAuth: true },
  { path: '/groups',               name: 'Groups',        needAuth: true },
  { path: '/activity',             name: 'Activity',      needAuth: true },
  { path: '/settings',             name: 'Settings',      needAuth: true },
  { path: '/settings/privacy',     name: 'Privacy',       needAuth: true },
  { path: '/admin',                name: 'AdminDashboard', needAuth: true },
  { path: '/admin/dashboard',      name: 'AdminDash2',     needAuth: true },
  { path: '/admin/users',          name: 'AdminUsers',     needAuth: true },
  { path: '/admin/analytics',      name: 'AdminAnalytics', needAuth: true },
  { path: '/admin/features',       name: 'AdminFeatures',  needAuth: true },
  { path: '/admin/reports',        name: 'AdminReports',   needAuth: true },
  { path: '/admin/content',        name: 'AdminContent',   needAuth: true },
  { path: '/admin/photos',         name: 'AdminPhotos',    needAuth: true },
  { path: '/admin/messaging',      name: 'AdminMessaging', needAuth: true },
  { path: '/admin/monetization',   name: 'AdminMonetization', needAuth: true },
];

async function main() {
  const browser = await chromium.launch({ headless: true });

  // --- Login once ---
  const loginCtx = await browser.newContext();
  const loginPage = await loginCtx.newPage();
  let userToken = null;
  let adminToken = null;

  try {
    const r = await loginPage.request.post(`${API}/api/auth/login`, {
      data: { email: 'demo@mail.ru', password: 'admin123' }
    });
    const body = await r.json();
    userToken = body.token;
  } catch { /* fallback */ }

  try {
    const r = await loginPage.request.post(`${API}/api/auth/dev-login`);
    const body = await r.json();
    adminToken = body.token;
  } catch { /* fallback */ }

  await loginCtx.close();

  console.log('=== SWIFTMATCH PAGE TEST ===\n');

  let total = 0, passed = 0, failed = 0;
  const results = [];

  for (const cfg of PAGES) {
    total++;
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const errors = [];

    page.on('console', msg => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    page.on('pageerror', err => errors.push(`[PAGE] ${err.message}`));

    try {
      // Set token before navigation
      if (cfg.needAuth) {
        const token = adminToken || userToken;
        if (token) {
          // Navigate first to set origin, then set localStorage
          await page.goto(`${URL}/login`, { waitUntil: 'domcontentloaded', timeout: 10000 });
          await page.evaluate(t => { localStorage.setItem('token', t); sessionStorage.setItem('swiftmatch_auth_token', t); document.cookie = `sm_token=${t}; path=/`; }, token);
        }
      }

      await page.goto(`${URL}${cfg.path}`, { waitUntil: 'networkidle', timeout: 15000 });
      await page.waitForTimeout(2000);

      // Collect remaining errors that came after networkidle
      await page.waitForTimeout(500);
    } catch (err) {
      errors.push(`[NAV] ${err.message}`);
    }

    const icon = errors.length === 0 ? '✅' : '❌';
    process.stdout.write(`${icon} ${cfg.name.padEnd(20)} ${cfg.path.padEnd(30)} errors=${errors.length}`);
    if (errors.length > 0) {
      failed++;
      process.stdout.write(` first: ${errors[0].substring(0, 120)}`);
    } else {
      passed++;
    }
    process.stdout.write('\n');

    results.push({ ...cfg, errors });
    await ctx.close();
  }

  console.log(`\n=== SUMMARY ===`);
  console.log(`Total: ${total}  Passed: ${passed}  Failed: ${failed}`);

  if (failed > 0) {
    console.log('\n❌ FAILED PAGES:');
    results.filter(r => r.errors.length > 0).forEach(r => {
      console.log(`  ${r.name.padEnd(20)} ${r.path}`);
      r.errors.slice(0, 2).forEach(e => console.log(`    ${e.substring(0, 200)}`));
    });
  }

  await browser.close();
}

main().catch(err => { console.error('FATAL:', err); process.exit(1); });
