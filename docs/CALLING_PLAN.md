# Alfrzo Ilm – In-app calling (LiveKit): Phase 2 architecture and implementation plan

Status: **PLAN FOR REVIEW.** Branch `feature/calling-livekit` (from `integration-release-v1` @ `969078d`), local only:
nothing pushed, merged or deployed; no production SQL. Migration `supabase/migrations/009_calls.sql` is a **draft for review**.

## 1. Approved rules (owner decision 1) and how they are enforced

| # | Rule | Where it is enforced |
|---|---|---|
| 1 | A client can call only the scholar of their own confirmed booking | `call_start()` checks `auth.uid()` is that booking's client or scholar |
| 2 | A scholar can call only clients with valid confirmed bookings with them | same function, same booking |
| 3 | Calls start from the consultation / its chat | `call_start(p_consultation, …)` takes a booking id, nothing else; buttons only in the booking chat and "My bookings" |
| 4 | Cancelled, expired, unconfirmed bookings never allow calls | `consultation_callable()`: status `confirmed`, time window 10 min before start → 15 min after end; re-checked at every token request (`call_join()`) |
| 5 | Paid bookings need a verified payment | `consultation_callable()`: price 0, or a `payments` row `purpose='consultation'`, `status='paid'` (a refunded payment no longer counts) |
| – | A booking's kind is respected | `chat` bookings never become calls; `audio` → voice only; `video` → voice or video |
| 6 | Only scholars and admins create group calls | `group_session_create()` requires `is_scholar()` (verified, not suspended) or `is_admin()` |
| 7 | Group members explicitly invited and authorised for the same session | host invites **through one of their own confirmed/completed bookings** (never by user id); the client must **accept** that session; only accepted members get media access |
| 8 | No mixing of unrelated users/bookings | each group belongs to one host's session; a call never pulls in anyone who has not accepted that session |
| 9 | Anonymity and privacy kept | other people are shown with the existing chat rule (scholar by name; client only if they do not keep questions anonymous), media identities are random per call, no user ids reach the browser, contact-info filter on session titles, camera starts OFF in group calls |

Suspended accounts cannot call. Group sessions are **free** in this version (paid group seats would need a new
payment flow – kept out on purpose, rule 5).

## 2. Architecture

```
Browser (existing app, plain JS)                    Node server (existing, no new npm packages)          Supabase (existing)
 ├─ public/js/call.js  call screen + LiveKit room     ├─ POST /api/calls/token   ─┐                      ├─ call_join(call)  (RLS / auth.uid())
 ├─ public/vendor/livekit-client.umd.js (pinned)      ├─ POST /api/calls/remove   ├─ verify login (/auth/v1/user)
 ├─ polls rpc call_incoming() every 4 s while open    ├─ POST /api/calls/end      ┘  then DB function with   ├─ calls, call_participants,
 └─ rpc call_start / call_answer / call_hangup …      └─ signs LiveKit JWT (HS256, node:crypto)  the user's token  ├─ group_sessions, …members
                     │                                         │  RoomService RemoveParticipant / DeleteRoom
                     └──────── WebRTC media (wss + UDP/TCP/TURN) ─────────►  LiveKit Cloud (TEST project first)
```

* **Media:** LiveKit Cloud (SFU, built-in STUN/TURN incl. TURN/TLS on 443). Self-hosting later = change `LIVEKIT_URL` + keys.
* **Signalling / state:** the database is the source of truth (ringing → active → ended / missed / declined / cancelled).
  LiveKit room events give the live view (who is connected, speaking, muted).
* **Incoming calls:** while the app is open and the person is logged in, `call_incoming()` is checked every 4 s
  (same approach as chat; no websocket exists in the app today). Supabase Realtime can replace polling later.
* **Fallback:** if `LIVEKIT_*` is not configured, the server reports calls as off and the app keeps the existing
  Jitsi "Join" link exactly as today.

## 3. Database – migration 009 (draft, additive only)

| Object | Purpose |
|---|---|
| `group_sessions` | host, title, voice/video, start, duration, capacity (2–50), status |
| `group_session_members` | invited / accepted / declined / removed, with the booking that authorised the invitation |
| `calls` | room name (random, unguessable), voice/video, origin = exactly one of booking **or** group session, host, status, times |
| `call_participants` | per person: host/guest, ringing / joined / declined / missed / left / removed, times |
| `notifications.type` | adds `'call'` (missed call, group invitation) |
| functions | `call_start`, `call_answer`, `call_hangup`, `call_join` (token gate), `call_incoming`, `call_state`, `call_end_all`, `call_remove`, `group_session_create/invite/respond/remove`, `group_call_start`; internal: `call_label`, `consultation_callable`, `call_housekeeping` (45 s → missed, window over → ended) |
| views | `call_history`, `group_session_list` (only my rows) |

* No client can read or write the 4 tables directly (`revoke all`); everything goes through the functions, which
  take the person from `auth.uid()`. Busy check, one live call per person, 6 calls / 10 min per caller.
* No tokens, keys or secrets are stored.
* Guard: `MISSING_PREVIOUS` before 008, `ALREADY_APPLIED` on a second run, one transaction.

**Checked locally (throw-away database, 32 rule checks):** stranger / chat booking / cancelled / unpaid paid booking /
booking in 3 days → refused; client → scholar call works; anonymous client stays anonymous; busy refused; stranger
and un-answered token requests refused; direct table read/insert refused; plain user cannot create a group; invite
through a cancelled booking refused; member must accept before joining; late acceptance joins the running call;
uninvited user refused; non-host cannot end for all; host removes a member who then cannot rejoin; 45-s missed call
+ notification; visitors cannot run any call function. Existing database tests still pass with 009 applied (63/63).
Still to do in implementation: health-check expectations for 009 (checks 3, 4, 5, 8, 9, 10, 13) and `tests/db7.test.mjs`.

## 4. Server endpoints (existing server, `server/calls.js`)

| Endpoint | Checks | Does |
|---|---|---|
| `POST /api/calls/token` `{call_id}` | Bearer login verified with Supabase; `call_join()` run **as that person**; rate limit 20/min/person | returns `{url, token}`: LiveKit JWT, **10 min**, room = that call's room, identity = random hash of the participant row, name = privacy label, publish sources = microphone (+ camera only for video calls), no room-admin rights |
| `POST /api/calls/end` `{call_id}` | login; `call_end_all()` (host only) | LiveKit `DeleteRoom` |
| `POST /api/calls/remove` `{call_id, participant}` | login; `call_remove()` (host only, guest of that call) | LiveKit `RemoveParticipant` |

* The server never takes a user id from the browser. `LIVEKIT_API_SECRET` is read from the environment only and is never
  sent to the browser; `config.js` gets only `CALLS: true/false` and `LIVEKIT_URL`.
* Start / answer / hang-up go straight from the browser to the database functions (same as chat and booking today).

## 5. Browser

* `public/js/call.js` – one call screen (overlay) used everywhere: outgoing (calling…/ringing), incoming (accept /
  decline), active voice (timer, mute, speaker), active video (camera on/off, switch front/back where supported,
  self preview, full screen), group (grid, active speaker, participant list, host: remove / end for all),
  reconnecting banner, audio-only fallback when the camera is not available, busy / declined / missed messages.
  Video: preview before joining; adaptive stream + dynacast + simulcast; 720p max, lower on poor networks.
  Clean-up on every exit: room disconnect, all tracks stopped, listeners and timers removed.
* Entry points: booking chat header (voice / video buttons when the booking allows it), "My bookings" (replaces the Jitsi
  link only when calls are on), `/calls` page (history + group sessions: create, invite from my bookings, accept, start/join).
* Incoming-call check every 4 s while open (paused when the tab is hidden), ringtone with the page's sound permission.
* Library: `livekit-client` **2.x pinned**, copied into `public/vendor/` (no CDN), loaded only when a call screen opens.

## 6. Configuration (server only; never in GitHub, never in chat)

| Variable | Example | Notes |
|---|---|---|
| `LIVEKIT_URL` | `wss://<project>.livekit.cloud` | public |
| `LIVEKIT_API_KEY` | `API…` | secret-ish |
| `LIVEKIT_API_SECRET` | – | **secret** |
| `CALLS_MAX_PARTICIPANTS` | `8` | server cap for group calls; set from the LiveKit plan, never above it |

Security headers change only when calls are on: `Permissions-Policy` camera/microphone `(self)`, CSP `connect-src` +
LiveKit host (wss/https), `media-src blob:`.

## 7. Testing plan

| Level | What | Needs |
|---|---|---|
| Database (`db7`) | every rule in section 1, RLS, cross-user access, busy, missed, group membership, host-only actions | local Postgres ✅ |
| Server | token endpoint: no login → 401, other person's call → 403, valid → JWT with right room/identity/grants/expiry; secret never in `config.js`; rate limit | none ✅ |
| Browser (mock LiveKit) | all screens and states, buttons only when allowed, clean-up, Jitsi fallback, phone layout | none ✅ |
| **Real calls** | 2 browsers with fake camera/mic → LiveKit **TEST** project: voice, video, toggles, reconnect, group join/leave/remove/end | **TEST project keys available to the test server** (see 8) |
| Devices | Android Chrome + desktop, by the owner, on a preview | owner |
| Regression | all existing suites (server 35, database 63, browser 29) | ✅ |

No statement "calls work" will be made before the real-call tests have connected to LiveKit.

## 8. How the TEST project keys reach the tests (no chat, no GitHub)

LiveKit tokens are **signed** with the secret, so the secret must be inside the test server's environment.
The owner adds, in this cloud environment's settings (**a personal environment for this repository, not the shared
Default**): `LIVEKIT_TEST_URL`, `LIVEKIT_TEST_API_KEY`, `LIVEKIT_TEST_API_SECRET` (TEST project only). A new session
picks them up. Production keys are added later, separately, in Render – only with the owner's approval.

## 9. Browser / OS limits (will be documented in the app's help)

* Incoming calls ring only while Alfrzo Ilm is open in a tab. Background ringing would need Web Push (optional, later,
  with explicit permission) and still does not work reliably on every phone (iOS Safari: only for an installed web
  app, iOS 16.4+). Booked consultations have a fixed time, so both sides are expected to have the app open.
* Speaker selection: desktop Chrome/Edge; on most phones the OS decides (earpiece/speaker/Bluetooth).
* Camera switching: phones with front/back cameras.
* Render free plan sleeps: the first token request after a pause can take ~1 min.

## 10. Stages (each one reviewable; nothing pushed without approval)

1. Migration 009 final + health check + `db7` tests.
2. Server: `calls.js` (JWT signing, 3 endpoints), config, security headers, server tests.
3. Browser: vendor library, `call.js`, entry points, `/calls` page, translations, mock-LiveKit browser tests.
4. Real-call tests against the LiveKit TEST project (needs section 8), fixes.
5. Full regression, security review, docs (env vars, deploy, rollback), report.
Deploy steps (later, separate approval): run 009 in Supabase → add LiveKit **production** keys in Render → merge.
Rollback: remove the `LIVEKIT_*` variables in Render (calls switch off, Jitsi returns) or roll back the deploy;
009 tables can stay (unused) – nothing else depends on them.
