# Alfrzo Ilm – Environment Variables

Taken from the code (`server/config.js`), not guessed. Set them in **Render → your service → Environment**.
Never put any of them into `public/js/config.js` – the server generates the browser config from them and only exposes public values.

## Required for the app to work
| Name | Where to find it | Example | Secret? |
|---|---|---|---|
| `SUPABASE_URL` | Supabase → Project Settings → API → Project URL | `https://abcdefghijklmnopqrst.supabase.co` (nothing after `.co`) | no |
| `SUPABASE_ANON_KEY` | Supabase → Project Settings → API Keys → **anon** (legacy, `eyJ…`) or **publishable** (`sb_publishable_…`) | – | no (public by design) |

If the secret `service_role` / `sb_secret_…` key is pasted here by mistake, the server **refuses** it and logs a warning.

## Recommended
| Name | Value | Purpose |
|---|---|---|
| `SITE_URL` | `https://alfrzo-ilm.onrender.com` (or your own domain) | canonical links, sitemap |
| `CONTACT_EMAIL` | your support email | shown on the privacy page |
| `TRUST_PROXY` | `1` on Render | number of proxies in front of the server (`0`/empty = none) |
| `NODE_VERSION` | `22` | Render's Node version |

Set automatically by Render – **do not add**: `PORT`.

## Optional
| Name | Default | Purpose |
|---|---|---|
| `MEETING_BASE_URL` | `https://meet.jit.si/` | address for audio/video consultation calls (must be https) |

## Only for payments (leave empty to keep payments OFF)
| Name | Secret? | Notes |
|---|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | **YES** | Supabase secret key. Server only. Needed for the 6 payment functions. |
| `RAZORPAY_KEY_ID` | no (but kept on the server) | |
| `RAZORPAY_KEY_SECRET` | **YES** | |
| `RAZORPAY_WEBHOOK_SECRET` | **YES** | webhook URL: `https://<your-site>/api/payments/webhook` |
| `PREMIUM_PRICE_PAISE` | no | default `9900` (= ₹99) |
| `PREMIUM_DAYS` | no | default `30` |
| `RAZORPAY_API_BASE` | no | tests only; default is Razorpay's real API |

Payments switch on only when `SUPABASE_SERVICE_ROLE_KEY`, `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET` are all set.

## What the browser receives (`/js/config.js`)
Only: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `PAYMENTS {enabled, amountPaise, days, currency}`, `MEETING_BASE`, `CONTACT_EMAIL`.
No secret is ever included (covered by an automated test).

## Supabase settings that are not environment variables
* **Authentication → URL Configuration:** Site URL = your site; Redirect URLs: add `https://<your-site>/reset`.
* **Authentication → Email:** keep "Confirm email" on. For launch, set up custom SMTP (the built-in sender is rate-limited).
