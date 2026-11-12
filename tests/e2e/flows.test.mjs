// Browser end-to-end tests: real Chromium -> our server -> real PostgREST -> real PostgreSQL with RLS.
// (Auth and Storage are small test look-alikes, see harness.mjs. Storage access still goes through the real RLS policies.)
// Run: PGHOST=/tmp/pgsock PGPORT=54329 node --test tests/e2e/flows.test.mjs   (needs tests/reset-db.sh done first)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startStack, sql } from './harness.mjs';
const { chromium } = createRequire(import.meta.url)('playwright');

const SHOTS = process.env.SHOTS || '';
let stack, browser, VIDEO; const errors = [];
const PW = 'Passw0rd!x';
const mk = async (lang = 'en', who = 'x') => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: Number(process.env.DSF || 1) });
  if (lang) await ctx.addInitScript(l => { try { localStorage.setItem('askdeen.lang', l); } catch {} }, lang);
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(`[${who}] pageerror: ${e.message}`));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(`[${who}] console: ${m.text()}`); });
  return { ctx, page };
};
const shot = async (page, name) => { if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await page.waitForTimeout(350); await page.screenshot({ path: `${SHOTS}/${name}.png` }); } };
const go = (page, p) => page.goto(stack.url + p);
const atHome = page => page.waitForFunction(() => location.pathname === '/', null, { timeout: 8000 });
const signup = async (page, name, email) => {
  await go(page, '/signup');
  await page.fill('#nm', name); await page.fill('#em', email); await page.fill('#pw', PW); await page.check('#ag');
  await page.click('form button[type=submit]'); await atHome(page);
};
const catId = slug => sql(`select id from categories where slug='${slug}'`);
const uid = email => sql(`select id from auth.users where email='${email}'`);
const api = async (page, pathAndQuery, init = {}) => {
  const tok = await page.evaluate(() => JSON.parse(localStorage.getItem('askdeen.session.v1')).access_token), cfg = await page.evaluate(() => window.ASKDEEN);
  return fetch(cfg.SUPABASE_URL + pathAndQuery, { ...init, headers: { apikey: cfg.SUPABASE_ANON_KEY, Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json', ...(init.headers || {}) } });
};
const toastText = async page => { await page.waitForSelector('.toast'); return page.locator('.toast').last().innerText(); };

let user, admin, scholar, visitor, qid, qpriv, SCH, convId;

before(async () => {
  // a real one-second WebM (VP8) for the reel upload; Chromium can decode it
  VIDEO = path.join(os.tmpdir(), `reel-${process.pid}.webm`);
  const ff = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=size=180x320:rate=10', '-t', '1', '-c:v', 'libvpx', '-b:v', '150k', VIDEO]);
  if (ff.status !== 0) VIDEO = null;
  stack = await startStack();
  browser = await chromium.launch();
  user = await mk('en', 'user'); admin = await mk('en', 'admin'); scholar = await mk('en', 'scholar'); visitor = await mk('en', 'visitor');
});
after(async () => { await browser?.close(); await stack?.stop(); if (VIDEO) fs.rmSync(VIDEO, { force: true }); if (errors.length) console.log('ERRORS SEEN:\n' + errors.join('\n')); });

// ============================== shell, home, explore ==============================
test('home opens in Hindi for a new visitor: brand, category stories with artwork, five-item bottom bar', async () => {
  const { ctx, page } = await mk(null, 'hindi');
  await go(page, '/'); await page.waitForSelector('.stories .story svg.art');
  assert.equal(await page.evaluate(() => document.documentElement.lang), 'hi');
  assert.match(await page.locator('.brand').innerText(), /Alfrzo Ilm/);
  assert.ok((await page.locator('.stories .story').count()) >= 9);
  assert.equal(await page.locator('nav.bottomnav a').count(), 5);
  assert.match(await page.locator('nav.bottomnav').innerText(), /होम/);
  await shot(page, '01-home-empty-hi'); await ctx.close();
});

test('explore shows every category as an illustrated tile; the side menu opens and closes', async () => {
  const { page } = visitor;
  await go(page, '/explore'); await page.waitForSelector('.tiles .tile svg.art');
  assert.equal(await page.locator('.tiles .tile').count(), Number(sql('select count(*) from categories where active')));
  await shot(page, '14-explore');
  await page.click('header.topbar button[aria-label="Menu"]'); await page.waitForSelector('nav.drawer');
  const menu = await page.locator('nav.drawer').innerText();
  for (const label of ['Home', 'Browse answers', 'Reels', 'Book consultation', 'Membership plans', 'Log in']) assert.ok(menu.includes(label), 'menu item: ' + label);
  await shot(page, '12-menu');
  await page.keyboard.press('Escape'); await page.waitForSelector('nav.drawer', { state: 'detached' });
});

// ============================== accounts ==============================
test('signup works, validation is enforced, and the profile shows the new account', async () => {
  const { page } = user;
  await go(page, '/signup'); await page.fill('#nm', 'Zaid'); await page.fill('#em', 'zaid@example.com'); await page.fill('#pw', 'short'); await page.check('#ag');
  await page.click('form button[type=submit]'); await page.waitForSelector('.err:not(:empty)');
  assert.match(await page.locator('.err').innerText(), /8 characters/);
  await signup(page, 'Zaid', 'zaid@example.com');
  await go(page, '/profile'); await page.waitForSelector('.me-head h1');
  assert.equal(await page.locator('.me-head h1').innerText(), 'Zaid');
  assert.ok(!(await page.locator('main').innerText()).includes('null'), 'no stray "null" text');
});

test('duplicate signup and wrong password are rejected with friendly messages', async () => {
  const { page } = visitor;
  await go(page, '/signup'); await page.fill('#nm', 'Dup'); await page.fill('#em', 'zaid@example.com'); await page.fill('#pw', PW); await page.check('#ag'); await page.click('form button[type=submit]');
  await page.waitForSelector('.err:not(:empty)'); assert.match(await page.locator('.err').innerText(), /already exists/);
  await go(page, '/login'); await page.fill('#em', 'zaid@example.com'); await page.fill('#pw', 'wrongpassword'); await page.click('form button[type=submit]');
  await page.waitForSelector('.err:not(:empty)'); assert.match(await page.locator('.err').innerText(), /Wrong email or password/);
});

test('private pages redirect a visitor to login', async () => {
  const { page } = visitor;
  for (const p of ['/ask', '/my-questions', '/settings', '/dashboard', '/admin', '/messages', '/consultations']) { await go(page, p); await page.waitForFunction(() => location.pathname === '/login', null, { timeout: 6000 }); }
});

// ============================== questions ==============================
test('asking: contact details are blocked, a clean question is accepted as pending and stays hidden from the public', async () => {
  const { page } = user;
  await go(page, '/ask'); await page.waitForSelector('#qt');
  await page.fill('#qt', 'Please call me on 9876543210 about zakat on gold'); await page.selectOption('#qc', catId('zakat'));
  await page.click('form button[type=submit]'); await page.waitForSelector('.err:not(:empty)');
  assert.match(await page.locator('.err').innerText(), /phone numbers/i);
  await page.fill('#qt', 'Is zakat due on gold jewellery worn every day?'); await page.fill('#qb', 'It is worn regularly and not kept for sale.');
  await page.evaluate(() => window.scrollTo(0, 0)); await shot(page, '03-ask');
  await page.click('form button[type=submit]'); await page.waitForSelector('.card.center h2');
  qid = sql(`select id from questions where title like 'Is zakat due%'`);
  assert.ok(qid); assert.equal(sql(`select status || '/' || visibility || '/' || is_anonymous from questions where id='${qid}'`), 'pending_review/public/true');
  await go(visitor.page, '/q/' + qid); await visitor.page.waitForSelector('.empty, .qd');
  assert.ok(await visitor.page.locator('.empty').count(), 'a pending question must not be visible to visitors');
  await go(page, '/my-questions'); await page.waitForSelector('.card.q');
  assert.match(await page.locator('.card.q').first().innerText(), /In review/);
});

test('a PRIVATE question is stored as private', async () => {
  const { page } = user;
  await go(page, '/ask'); await page.waitForSelector('#qt');
  await page.click('.seg button:has-text("Private")');
  assert.match(await page.locator('form').innerText(), /Only you, verified scholars \(so that one of them can answer\) and admins/);
  await page.fill('#qt', 'A private family matter about inheritance shares'); await page.selectOption('#qc', catId('family'));
  await page.click('form button[type=submit]'); await page.waitForSelector('.card.center h2');
  qpriv = sql(`select id from questions where title like 'A private family%'`);
  assert.equal(sql(`select visibility from questions where id='${qpriv}'`), 'private');
});

test('admin: non-admin is refused, promoted admin sees stats and approves both questions', async () => {
  const { page } = admin;
  await signup(page, 'Boss', 'boss@example.com');
  await go(page, '/admin'); await page.waitForSelector('.notice.bad');
  assert.match(await page.locator('.notice.bad').innerText(), /Administrators only/);
  const r = await api(page, '/rest/v1/rpc/admin_stats', { method: 'POST', body: '{}' });   // the database decides, not the page
  assert.ok(r.status >= 400 && /FORBIDDEN/.test(await r.text()), 'non-admin RPC must be FORBIDDEN');

  sql(`update profiles set role='admin' where id='${uid('boss@example.com')}'`);
  await go(page, '/admin'); await page.waitForSelector('.kpis .kpi');
  assert.match(await page.locator('.kpis').innerText(), /Waiting for review/);
  await shot(page, '10-admin');
  await page.click('button.chip:has-text("Questions")'); await page.waitForSelector('.card.q h3');
  assert.equal(await page.locator('.card.q').count(), 2);
  await page.click('.card.q button:has-text("Approve")'); await page.waitForFunction(() => document.querySelectorAll('.card.q').length === 1);
  await page.click('.card.q button:has-text("Approve")'); await page.waitForFunction(() => document.querySelectorAll('.card.q').length === 0);
  assert.equal(sql(`select string_agg(status, ',') from questions`), 'open,open');
  assert.equal(sql(`select count(*) from audit_logs where action='moderate_question'`), '2');
});

test('visitor sees the public question in "All questions" (asker hidden) and never the private one', async () => {
  const { page } = visitor;
  await go(page, '/qa'); await page.waitForSelector('.qrow h3');
  assert.equal(await page.locator('.qrow').count(), 1);
  const txt = await page.locator('.qrows').innerText();
  assert.match(txt, /zakat due on gold/); assert.ok(!/Zaid|private family/.test(txt));
  await shot(page, '15-all-questions');
  await page.click('button.chip:has-text("Unanswered")'); await page.waitForSelector('.qrow h3'); assert.equal(await page.locator('.qrow').count(), 1);
  await go(page, '/q/' + qid); await page.waitForSelector('.qd h1');
  const html = await page.content(); assert.ok(!html.includes('zaid@example.com')); assert.match(await page.locator('.asker').innerText(), /Anonymous/);
  await go(page, '/q/' + qpriv); await page.waitForSelector('.empty'); assert.equal(await page.locator('.qd').count(), 0);
  const direct = await fetch((await page.evaluate(() => window.ASKDEEN.SUPABASE_URL)) + `/rest/v1/questions?id=eq.${qpriv}&select=title`, { headers: { apikey: await page.evaluate(() => window.ASKDEEN.SUPABASE_ANON_KEY) } });
  assert.ok(direct.status >= 400 || (await direct.json()).length === 0, 'private question must not be readable through the API either');
});

// ============================== scholars ==============================
test('scholar: applies, admin verifies, scholar answers the public and the private question', async () => {
  const { page } = scholar;
  await signup(page, 'Mufti Rashid', 'rashid@example.com'); SCH = uid('rashid@example.com');
  await go(page, '/become-scholar'); await page.waitForSelector('#bq');
  await page.fill('#bq', 'Alimiyyah, Ifta course 2018'); await page.click('button.chip:has-text("Zakat")'); await page.fill('#bn', 'Studied at Madrasa X, graduated 2016, teacher Mufti Y can confirm.');
  await page.fill('#bb', 'Call me on 9876543210'); await page.click('form button[type=submit]'); await page.waitForSelector('.err:not(:empty)');
  assert.match(await page.locator('.err').innerText(), /phone numbers/i);
  await page.fill('#bb', 'Teaches fiqh of worship and family matters.'); await page.click('form button[type=submit]'); await page.waitForSelector('.tag.warn');
  assert.equal(sql(`select status from scholar_applications`), 'pending');

  const sv = await api(page, '/rest/v1/profiles?id=eq.' + SCH, { method: 'PATCH', body: JSON.stringify({ role: 'admin' }) });
  assert.ok(sv.status >= 400, 'role escalation must be rejected'); assert.equal(sql(`select role from profiles where id='${SCH}'`), 'user');

  const ap = admin.page; await go(ap, '/admin?tab=scholars'); await ap.waitForSelector('button:has-text("Approve & verify")');
  assert.match(await ap.content(), /Madrasa X/);
  await ap.click('button:has-text("Approve & verify")'); await ap.waitForSelector('.toast');
  assert.equal(sql(`select verified from scholars where id='${SCH}'`), 't');

  await go(page, '/dashboard'); await page.waitForSelector('.card.q h3');
  assert.equal(await page.locator('.card.q').count(), 2);
  assert.match(await page.locator('.card.q:has-text("private family")').innerText(), /Private/);
  assert.ok(!/Zaid|zaid@/.test(await page.content()), 'scholar must not see who asked');
  await shot(page, '08-scholar-dashboard');
  const answer = async (title, text, ref) => {
    await go(page, '/dashboard'); await page.waitForSelector('.card.q h3');
    await page.click(`.card.q:has-text("${title}")`); await page.waitForSelector('form textarea');
    const ta = page.locator('form textarea'); await ta.nth(0).fill(text);
    if (ref) { await ta.nth(1).fill(ref); await page.click('form input[type=checkbox]'); }
    await page.click('form button[type=submit]'); await page.waitForSelector('article.ans');
    assert.match(await page.locator('article.ans').innerText(), /Mufti Rashid/);
  };
  await answer('zakat due on gold', 'Zakat is due on gold jewellery if it reaches the nisab and a lunar year passes, according to the Hanafi position.', 'Surah At-Tawbah 9:34');
  await answer('private family', 'Inheritance shares depend on exactly which heirs are alive. Please list them so the shares can be worked out.');
  assert.equal(sql(`select count(*) from answers`), '2'); assert.equal(sql(`select string_agg(status, ',') from questions`), 'answered,answered');
});

test('private answer: the asker reads it, a visitor cannot, and it is not in any public list', async () => {
  const { page } = user;
  await go(page, '/q/' + qpriv); await page.waitForSelector('article.ans');
  assert.match(await page.locator('.qd').innerText(), /Private/); assert.match(await page.locator('article.ans').innerText(), /Inheritance shares depend/);
  const v = visitor.page;
  await go(v, '/q/' + qpriv); await v.waitForSelector('.empty'); assert.equal(await v.locator('article.ans').count(), 0);
  await go(v, '/'); await v.waitForSelector('.card.post'); assert.equal(await v.locator('.card.post').count(), 1);
  assert.ok(!(await v.locator('main').innerText()).includes('Inheritance shares'));
  await go(v, '/scholar/' + SCH); await v.waitForSelector('.sp-head h1'); await v.waitForSelector('.card.q');
  assert.equal(await v.locator('.card.q').count(), 1, 'only the public answer is listed on the scholar profile');
});

test('asker is notified, sees the best answer, marks it helpful, saves it and follows the scholar', async () => {
  const { page } = user;
  await go(page, '/notifications'); await page.waitForSelector('.card.notif');
  assert.match(await page.locator('main').innerText(), /Mufti Rashid answered your question/);
  await go(page, '/q/' + qid); await page.waitForSelector('article.ans');
  assert.match(await page.locator('main').innerText(), /Best answer/);
  await page.click('article.ans button:has-text("Helpful")'); await page.click('article.ans button:has-text("Save")'); await page.waitForTimeout(500);
  assert.equal(sql(`select helpful_count from answers where question_id='${qid}'`), '1'); assert.equal(sql(`select count(*) from saved_answers`), '1');
  await page.evaluate(() => window.scrollTo(0, 0)); await page.waitForSelector('.toast', { state: 'detached', timeout: 9000 }); await shot(page, '05-question-detail');
  await go(page, '/scholar/' + SCH); await page.waitForSelector('.sp-actions button');
  await page.click('.sp-actions button'); await page.waitForFunction(() => /Following/.test(document.querySelector('.sp-actions button').textContent));
  assert.equal(sql(`select count(*) from scholar_followers`), '1');
  assert.match(await page.locator('.sp-stats').innerText(), /1\s*followers/i);
  await go(page, '/saved'); await page.waitForSelector('.card');
  // home now has "Aaj ka Sawal" and the answer feed
  await go(page, '/'); await page.waitForSelector('.today h2'); await page.waitForSelector('.card.post');
  assert.match(await page.locator('.today').innerText(), /zakat due on gold/);
  await shot(page, '02-home');
});

// ============================== consultations + messages ==============================
test('scholar sets services and opens times; a paid service cannot be booked while payments are off', async () => {
  const { page } = scholar;
  await go(page, '/dashboard?tab=consults'); await page.waitForSelector('label.switch:has-text("Chat")');
  await page.check('label.switch:has-text("Chat") input'); await page.check('label.switch:has-text("Video call") input');
  await page.fill('input[aria-label="Video call: Price (₹)"]', '299');
  await page.click('button:has-text("Save")'); assert.match(await toastText(page), /Saved/);
  assert.equal(sql(`select string_agg(kind || ':' || price_paise, ',' order by kind) from scholar_services where active`), 'chat:0,video:29900');
  const d = new Date(Date.now() + 86400000), pad = n => String(n).padStart(2, '0'), day = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  for (const hh of ['10:00', '11:00']) { await page.waitForSelector('#sl'); await page.fill('#sl', `${day}T${hh}`); await page.click('button:has-text("Add time")'); await page.waitForFunction(n => document.querySelectorAll('button[aria-label="Delete"]').length === n, hh === '10:00' ? 1 : 2); }
  assert.equal(sql(`select count(*) from scholar_slots where status='open'`), '2');
  await page.waitForSelector('.toast', { state: 'detached', timeout: 9000 }); await page.evaluate(() => window.scrollTo(0, 0)); await shot(page, '09-scholar-consultations');
  await page.fill('#sl', '2020-01-01T10:00'); await page.click('button:has-text("Add time")'); await page.waitForSelector('.err:not(:empty)');

  const u = user.page;
  await go(u, '/consult/' + SCH); await u.waitForSelector('.svc button');
  assert.equal(await u.locator('.svc button').count(), 2);
  await u.click('.slots .chip'); await u.click('.svc button:has-text("Video call")');
  assert.match(await u.locator('main').innerText(), /payments are not switched on/i);
  assert.ok(await u.locator('main > button.btn.block').isDisabled(), 'paid booking must be disabled without a payment gateway');
  const forced = await api(u, '/rest/v1/consultations', { method: 'POST', body: JSON.stringify({ user_id: uid('zaid@example.com'), scholar_id: SCH, kind: 'video', price_paise: 0, duration_min: 30, starts_at: new Date().toISOString(), status: 'confirmed' }) });
  assert.ok(forced.status >= 400, 'a client can never write a booking row directly');
});

test('user books a free chat consultation: confirmed at once, slot taken, private thread opens', async () => {
  const u = user.page;
  await go(u, '/consult/' + SCH); await u.waitForSelector('.svc button');
  await u.click('.svc button:has-text("Chat")'); await u.click('.slots .chip >> nth=0');
  await u.fill('#ct', 'Call me at 9876543210'); await u.click('main > button.btn.block'); await u.waitForSelector('.err:not(:empty)');
  assert.match(await u.locator('.err').innerText(), /phone numbers/i);
  await u.fill('#ct', 'Questions about inheritance shares');
  await shot(u, '06-book-consultation');
  await u.click('main > button.btn.block'); await u.waitForFunction(() => location.pathname === '/consultations', null, { timeout: 8000 });
  await u.waitForSelector('.card h3');
  assert.equal(sql(`select status || '/' || kind || '/' || price_paise from consultations`), 'confirmed/chat/0');
  assert.equal(sql(`select string_agg(status, ',' order by starts_at) from scholar_slots`), 'booked,open');
  convId = sql(`select id from conversations`); assert.ok(convId);
  assert.match(await u.locator('main .card').first().innerText(), /Mufti Rashid[\s\S]*Confirmed|Confirmed[\s\S]*Mufti Rashid/);
});

test('messages: both sides talk privately, contact details are blocked in the page and in the database, strangers see nothing', async () => {
  const u = user.page, s = scholar.page;
  await go(u, '/messages'); await u.waitForSelector('.convo'); await u.click('.convo'); await u.waitForSelector('#mi');
  await u.fill('#mi', 'Assalamu alaikum, my number is 9876543210'); await u.keyboard.press('Enter');
  assert.match(await toastText(u), /phone numbers/i); assert.equal(sql('select count(*) from messages'), '0');
  const raw = await api(u, '/rest/v1/messages', { method: 'POST', body: JSON.stringify({ conversation_id: convId, sender_id: uid('zaid@example.com'), body: 'mail me at zaid@example.com' }) });
  assert.ok(raw.status >= 400 && /CONTACT_INFO/.test(await raw.text()), 'the database itself must refuse contact details');
  await u.fill('#mi', 'Assalamu alaikum, there are three heirs.'); await u.keyboard.press('Enter'); await u.waitForSelector('.bub.me');

  await go(s, '/messages'); await s.waitForSelector('.convo');
  const row = await s.locator('.convo').innerText();
  assert.match(row, /Anonymous user/); assert.ok(!/Zaid|zaid@/.test(row), 'scholar must not learn who an anonymous user is');
  assert.match(row, /three heirs/);
  await s.click('.convo'); await s.waitForSelector('.bub'); await s.fill('#mi', 'Wa alaikum assalam. Please name the three heirs.'); await s.keyboard.press('Enter'); await s.waitForSelector('.bub.me');
  await u.waitForSelector('.bub:not(.me)', { timeout: 9000 });   // arrives by polling
  assert.equal(sql('select count(*) from messages'), '2');
  await u.waitForSelector('.toast', { state: 'detached', timeout: 9000 }); await shot(u, '07-messages');
  const boss = await api(admin.page, `/rest/v1/conversation_list?select=id`); assert.equal((await boss.json()).length, 0, 'not a participant: nothing in the inbox');
  const peek = await fetch((await u.evaluate(() => window.ASKDEEN.SUPABASE_URL)) + '/rest/v1/messages?select=body', { headers: { apikey: await u.evaluate(() => window.ASKDEEN.SUPABASE_ANON_KEY) } });
  assert.ok(peek.status >= 400 || (await peek.json()).length === 0, 'logged-out visitors read no messages');
});

test('cancelling a booking frees the time and closes the thread', async () => {
  const u = user.page;
  await go(u, '/consultations'); await u.waitForSelector('button:has-text("Cancel booking")');
  await u.click('button:has-text("Cancel booking")'); await u.click('.sheet button.danger'); await u.waitForSelector('.tag.red');
  assert.equal(sql('select status from consultations'), 'cancelled'); assert.equal(sql(`select count(*) from scholar_slots where status='open'`), '2');
  await go(u, '/messages/' + convId); await u.waitForSelector('.notice.warn'); assert.equal(await u.locator('#mi').count(), 0);
  const late = await api(u, '/rest/v1/messages', { method: 'POST', body: JSON.stringify({ conversation_id: convId, sender_id: uid('zaid@example.com'), body: 'one more thing' }) });
  assert.ok(late.status >= 400, 'no messages after the consultation is closed');
});

// ============================== reels ==============================
test('reels: only a verified scholar can upload; the video plays for visitors; likes are counted', { skip: false }, async t => {
  if (!VIDEO) return t.skip('ffmpeg could not make a test video');
  const video = fs.readFileSync(VIDEO);
  const cfgUrl = await user.page.evaluate(() => window.ASKDEEN.SUPABASE_URL), userTok = await user.page.evaluate(() => JSON.parse(localStorage.getItem('askdeen.session.v1')).access_token);
  const denied = await fetch(`${cfgUrl}/storage/v1/object/reels/${uid('zaid@example.com')}/${crypto.randomUUID()}.webm`, { method: 'POST', headers: { Authorization: 'Bearer ' + userTok, 'Content-Type': 'video/webm' }, body: video });
  assert.equal(denied.status, 403, 'a normal user cannot upload into the reels bucket');

  const s = scholar.page;
  await go(s, '/dashboard?tab=reels'); await s.waitForSelector('#rf');
  await s.setInputFiles('#rf', VIDEO); await s.fill('#rc', 'WhatsApp me on 9876543210'); await s.click('form button[type=submit]'); await s.waitForSelector('.err:not(:empty)');
  await s.fill('#rc', 'The purpose of the five daily prayers'); await s.click('form button[type=submit]');
  assert.match(await toastText(s), /Reel published/);
  assert.equal(sql('select count(*) from reels'), '1'); assert.equal(sql(`select count(*) from storage.objects where bucket_id='reels'`), '1');

  const v = visitor.page;
  await go(v, '/reels'); await v.waitForSelector('article.reel video');
  await v.waitForFunction(() => document.querySelector('article.reel video').readyState >= 1, null, { timeout: 10000 });
  assert.ok(await v.evaluate(() => document.querySelector('article.reel video').videoWidth) > 0, 'the uploaded video really decodes');
  assert.match(await v.locator('article.reel').innerText(), /Mufti Rashid[\s\S]*five daily prayers/);
  await shot(v, '04-reels');
  const u = user.page; await go(u, '/reels'); await u.waitForSelector('article.reel button[aria-label="Like"]');
  await u.click('article.reel button[aria-label="Like"]'); await u.waitForFunction(() => document.querySelector('article.reel button[aria-label="Like"]').getAttribute('aria-pressed') === 'true');
  assert.equal(sql('select likes_count from reels'), '1');
  await go(v, '/scholar/' + SCH); await v.waitForSelector('.sp-head h1'); await shot(v, '11-scholar-profile');
  await v.click('.utabs button:has-text("Reels")'); await v.waitForSelector('.vgrid video');
});

// ============================== moderation ==============================
test('reporting: user reports an answer and a reel, admin hides both, they disappear for the public', async () => {
  const { page } = user; await go(page, '/q/' + qid); await page.waitForSelector('article.ans');
  await page.click('article.ans button:has-text("Report")'); await page.waitForSelector('.sheet select'); await page.selectOption('.sheet select', 'wrong_ref'); await page.click('.sheet button:has-text("Send report")');
  assert.match(await toastText(page), /Report received/); assert.equal(sql(`select count(*) from reports`), '1');
  const ap = admin.page; await go(ap, '/admin?tab=reports'); await ap.waitForSelector('button:has-text("Hide content")');
  assert.match(await ap.locator('main .card').first().innerText(), /Wrong Quran\/Hadith reference/);
  await ap.click('button:has-text("Hide content")'); await ap.click('.sheet button.danger'); await ap.waitForFunction(() => !document.querySelector('button.danger'), null, { timeout: 8000 });
  assert.equal(sql(`select status from answers where question_id='${qid}'`), 'hidden'); assert.equal(sql(`select status from reports`), 'resolved');
  await go(visitor.page, '/q/' + qid); await visitor.page.waitForSelector('.qd h1'); await visitor.page.waitForTimeout(300);
  assert.equal(await visitor.page.locator('article.ans').count(), 0);

  if (sql('select count(*) from reels') === '1') {
    await go(page, '/reels'); await page.waitForSelector('article.reel button[aria-label="Report"]'); await page.click('article.reel button[aria-label="Report"]');
    await page.waitForSelector('.sheet select'); await page.click('.sheet button:has-text("Send report")'); await page.waitForSelector('.sheet', { state: 'detached' });
    await go(ap, '/admin?tab=reports'); await ap.waitForSelector('button:has-text("Hide content")');
    await ap.click('button:has-text("Hide content")'); await ap.click('.sheet button.danger'); await ap.waitForFunction(() => !document.querySelector('button.danger'), null, { timeout: 8000 });
    assert.equal(sql('select status from reels'), 'hidden');
    await go(visitor.page, '/reels'); await visitor.page.waitForSelector('.empty'); assert.equal(await visitor.page.locator('article.reel').count(), 0);
  }
});

// ============================== account ==============================
test('settings: profile, anonymity default, password change, language switch', async () => {
  const { page } = user; await go(page, '/settings'); await page.waitForSelector('#dn');
  await page.fill('#dn', 'Zaid Khan'); await page.click('form button:has-text("Save")'); await page.waitForSelector('.toast');
  assert.equal(sql(`select display_name from profiles where id='${uid('zaid@example.com')}'`), 'Zaid Khan');
  await page.uncheck('label.switch:has-text("anonymous") input'); await page.waitForTimeout(500);
  assert.equal(sql(`select default_anonymous from profiles where id='${uid('zaid@example.com')}'`), 'f');
  await page.fill('#npw', 'NewPassw0rd!'); await page.click('form button:has-text("Change password")'); await page.waitForSelector('.toast');
  await go(page, '/profile'); await page.waitForSelector('.me-head h1'); await shot(page, '13-my-profile');
  await page.click('button.li:has-text("Language")'); await page.waitForFunction(() => document.documentElement.lang === 'hi');
  await page.waitForSelector('.me-head h1'); assert.equal(await page.locator('.me-head h1').innerText(), 'Zaid Khan');
  assert.match(await page.locator('nav.bottomnav').innerText(), /होम/);
  await page.click('button.li:has-text("Language")'); await page.waitForFunction(() => document.documentElement.lang === 'en');
});

test('premium: with no gateway configured the page says so and offers no buy button', async () => {
  const { page } = user; await go(page, '/premium'); await page.waitForSelector('.premium');
  await page.waitForSelector('.premium .notice.warn');          // "payments are not switched on" appears once the profile has loaded
  assert.equal(await page.locator('.premium button').count(), 0);
});

test('phone layout: no page scrolls sideways', async () => {
  const { page } = user;
  for (const p of ['/', '/explore', '/qa', '/q/' + qid, '/scholars', '/scholar/' + SCH, '/consult/' + SCH, '/reels', '/messages', '/consultations', '/profile', '/settings', '/premium', '/privacy', '/ask']) {
    await go(page, p); await page.waitForSelector('main > *'); await page.waitForTimeout(350);
    const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert.ok(over <= 1, `${p} overflows sideways by ${over}px`);
  }
});

test('privacy page renders and the account can be deleted completely (bookings, threads and messages go with it)', async () => {
  const { page } = user; await go(page, '/privacy'); await page.waitForSelector('section.card'); assert.ok((await page.locator('section.card').count()) >= 9);
  await go(page, '/settings'); await page.waitForSelector('button.danger'); await page.click('button.danger'); await page.click('.sheet button.danger'); await atHome(page);
  assert.equal(sql(`select count(*) from auth.users where email='zaid@example.com'`), '0');
  assert.equal(sql(`select (select count(*) from questions) + (select count(*) from consultations) + (select count(*) from conversations) + (select count(*) from messages)`), '0');
  const v = await mk('en', 'relogin'); await go(v.page, '/login'); await v.page.fill('#em', 'zaid@example.com'); await v.page.fill('#pw', 'NewPassw0rd!'); await v.page.click('form button[type=submit]');
  await v.page.waitForSelector('.err:not(:empty)');
});

test('no uncaught JavaScript errors happened in any flow', () => { assert.deepEqual(errors, []); });
