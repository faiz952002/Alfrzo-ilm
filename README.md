# Alfrzo Ilm — सवाल पूछो, इल्म पाओ

Islamic sawal-jawab platform: log sawal puchte hain, **verified aalim/mufti** jawab dete hain, consultation book hoti hai, aalim reels daalte hain, admin sab moderate karta hai.

- **Frontend:** `public/` — HTML/CSS/JS (no build step), Hindi + English, mobile app jaisa UI
- **Backend:** Supabase (Auth + PostgreSQL + Row Level Security + Storage) — `supabase/*.sql`
- **Server:** `server/` — Node 20+, zero npm dependencies (config, security headers, SEO, payment verification)

## Setup (ek baar)

1. **Supabase project banao** — https://supabase.com (free plan se shuru ho sakta hai).
2. **SQL Editor** me ye 4 files **isi order me** poori paste karke Run karo:
   `supabase/schema.sql` → `patch_001.sql` → `patch_002.sql` → `patch_003.sql`
3. **Authentication > URL Configuration:** Site URL = aapki site; Redirect URLs me `https://your-domain.com/reset` jodo.
4. **Deploy** (Render example): repo GitHub par daalo → Render > New > Blueprint (`render.yaml`) → env vars bharo (`.env.example` dekho).
   Local chalane ke liye: `SUPABASE_URL=... SUPABASE_ANON_KEY=... npm start` → http://localhost:3000
   **GitHub Pages par nahi chalega:** app ko `server/server.js` (Node) chahiye — config, payments aur SEO wahi se aate hain.
5. **Pehla admin:** app me normal signup karo, phir Supabase SQL Editor me:
   ```sql
   update public.profiles set role = 'admin'
   where id = (select id from auth.users where email = 'AAPKA_EMAIL');
   ```
   Ab Profile > Admin panel dikhega.

## Kaun kya karta hai

| Kaun | Kya karta hai | Kahan |
|---|---|---|
| User | Signup, sawal (general ya private, gumnaam), save, follow, report, consultation book, chat, reels dekhna | `/ask`, `/qa`, `/consult/:id`, `/messages`, `/reels` |
| Aalim | Apply → admin verify → jawab, apni services aur khule time, bookings, reels upload | `/become-scholar`, `/dashboard` |
| Admin | Sawal approve/reject, aalim verify, reports (sawal, jawab, reel, chat), users, categories, consultations aur refunds, payments, audit log | `/admin` |

- Har naya sawal pehle **"In review"** me jaata hai; admin approve kare tabhi aage badhta hai.
- **Private sawal** kabhi public nahi hota: sirf puchne wala, jawab dene wale aalim aur admin dekh sakte hain.
- **Chat** sirf confirmed consultation ke andar khulti hai. Phone number, email aur link database khud rokta hai.

## Consultation

- Aalim dashboard me har type (audio / video / chat) ki keemat aur samay tay karta hai, phir khule time jodta hai.
- **Free** (₹0) booking turant confirm hoti hai. **Paid** booking tabhi confirm hoti hai jab server Razorpay se payment verify kar le.
  Payment keys ke bina paid booking ka button band rehta hai.
- **Audio/Video call** app ke andar nahi chalti: tay samay par ek private link khulta hai (default `https://meet.jit.si/`).
  Jitsi par call shuru karne wale ko ek baar sign in karna padta hai. Apna server ho to `MEETING_BASE_URL` set karo.
- Paid booking cancel ho to admin panel me "refund due" dikhta hai; refund Razorpay dashboard se karke "Refund done" dabao.
- Aalim ko unka hissa dena abhi manual hai (app me payout system nahi hai).

## Reels

Sirf verified aalim MP4/WebM (30 MB tak) upload kar sakte hain. Video Supabase Storage ke public `reels` bucket me jaata hai,
isliye storage aur bandwidth ka kharch dhyan me rakho.

## Premium payments (optional)

Jab tak Razorpay keys set nahi, Premium page saaf likhta hai ki payment band hai (koi fake success nahi).
Chalu karne ke liye `.env.example` ke payment variables set karo aur Razorpay Dashboard > Webhooks me
`https://your-domain.com/api/payments/webhook` jodo (events: `payment.captured`, `payment.failed`, `refund.processed`).
Price server tay karta hai; browser kabhi payment ko "paid" mark nahi kar sakta.

## Security ke niyam

- `SUPABASE_SERVICE_ROLE_KEY`, Razorpay secrets **sirf server env** me. `public/` me kabhi nahi.
- Saari permissions database me RLS/RPC se enforce hoti hain; browser ke role check sirf UI ke liye hain.
- Rate limit memory me hai (ek server instance ke liye). Kai instances chalao to shared store lagao.

## Tests

```bash
npm test            # server: config, headers, payments, webhook, SEO (fake upstreams)
npm run test:db     # schema + RLS + RPCs on real PostgreSQL   (pehle tests/reset-db.sh)
npm run test:e2e    # Chromium -> server -> PostgREST -> PostgreSQL (tests/e2e/harness.mjs dekho)
```
