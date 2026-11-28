#!/usr/bin/env bash
# Migration safety tests (M1-M6, H1) on DISPOSABLE databases only, through the mandatory guard.
# Every database used here is an exact allowlisted key of tests/lib/db-guard.sh; nothing is matched by pattern.
# Any unexpected result stops the script with a non-zero exit code. Production is never touched.
set -euo pipefail
cd "$(dirname "$0")/.."
G="bash tests/lib/db-guard.sh"
M=supabase/migrations
FAILS=0

say()    { printf '%s\n' "$*"; }
expect() { if [ "$2" = "$3" ]; then say "  ok   $1"; else say "  FAIL $1: got [$2] want [$3]"; FAILS=$((FAILS + 1)); fi; }
run()    { $G run "$1" -q < "$2" >/dev/null 2>"$TMPD/err" ; }                 # apply a file; 0 / non-zero
runmsg() { { $G run "$1" -q < "$2" 2>&1 >/dev/null || true; } | tr '\n' ' '; }   # the error text of a refused file
q()      { printf '%s\n' "$2" | $G run "$1" -q -t -A; }
hc()     { $G run "$1" -q -t -A < supabase/DATABASE_HEALTH_CHECK.sql | grep '^99|' | cut -d'|' -f3; }
hcf()    { $G run "$1" -q -t -A < supabase/DATABASE_HEALTH_CHECK.sql | grep '|f|' | grep -v '^99|' | cut -d'|' -f1 | tr '\n' ' ' | sed 's/ $//'; }
fp()     { $G dump "$1" | grep -v '^--' | grep -vE '^.(un)?restrict ' | md5sum | cut -c1-12; }
data()   { q "$1" "select md5(coalesce(string_agg(x, '|' order by x), '')) from (
             select p::text x from (select id, display_name, role, language, default_anonymous, notify_answers, notify_followed, created_at, suspended from profiles) p
             union all select q::text from questions q union all select n::text from notifications n
             union all select s::text from subscriptions s union all select y::text from payments y union all select k::text from consultations k) z"; }
TMPD="$(mktemp -d)"; trap 'rm -rf "$TMPD"' EXIT

fresh() {   # $1 key, $2 plain|supabase : exact allowlisted database, shim, optional Supabase-style default privileges
  $G reset "$1" >/dev/null
  run "$1" tests/supabase_shim.sql
  if [ "$2" = supabase ]; then
    q "$1" "alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
            alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
            alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;" >/dev/null
  fi
}
upto() { local f n; for f in $M/00[1-9]_*.sql; do n="$(basename "$f" | cut -c1-3)"; [ "$((10#$n))" -le "$2" ] || continue; run "$1" "$f" || { say "  FAIL applying $f"; cat "$TMPD/err"; exit 1; }; done; }
seed() {
  q "$1" "insert into auth.users(id,email,raw_user_meta_data) values
   ('11111111-1111-1111-1111-111111111111','u1@example.com','{\"display_name\":\"π ʒ^07 !\"}'),
   ('22222222-2222-2222-2222-222222222222','s1@example.com','{\"display_name\":\"Scholar One\"}');
  update profiles set role='scholar' where id='22222222-2222-2222-2222-222222222222';
  insert into scholars(id,verified,verified_at,qualifications) values ('22222222-2222-2222-2222-222222222222',true,now(),'Mufti');
  insert into questions(user_id,category_id,title,body,status) values ('11111111-1111-1111-1111-111111111111',(select id from categories where slug='zakat'),'Is zakat due on gold jewellery?','Test body','open');
  insert into consultations(user_id,scholar_id,kind,price_paise,duration_min,starts_at,status,meeting_room) values ('11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222','video',0,30,now()+interval '1 day','confirmed','roomabc');
  insert into payments(user_id,amount_paise,currency,provider,provider_order_id,provider_payment_id,status,purpose) values ('11111111-1111-1111-1111-111111111111',9900,'INR','razorpay','order_OLD1','pay_OLD1','paid','premium');
  insert into notifications(user_id,type,data) values ('11111111-1111-1111-1111-111111111111','system','{}');" >/dev/null
}
inject_failure() { sed 's/^commit;$/select 1\/0;   -- injected failure\ncommit;/' "$1" > "$TMPD/broken.sql"; }

for mode in plain supabase; do
  say "[$mode]"
  # M1 fresh 001-009
  K="m_fresh_$mode"; fresh "$K" "$mode"; upto "$K" 9
  expect "M1 fresh 001-009 health" "$(hc "$K")" "21 of 21 checks passed"
  # M2 upgrade with data 001-008 -> 009
  K="m_up_$mode"; fresh "$K" "$mode"; upto "$K" 8; seed "$K"; d1="$(data "$K")"
  run "$K" $M/009_calls.sql || { say "  FAIL 009 upgrade"; cat "$TMPD/err"; exit 1; }
  expect "M2 upgrade: existing data unchanged" "$(data "$K")" "$d1"
  expect "M2 upgrade: unusual existing name kept" "$(q "$K" "select display_name from profiles where id='11111111-1111-1111-1111-111111111111'")" "π ʒ^07 !"
  expect "M2 upgrade: health" "$(hc "$K")" "21 of 21 checks passed"
  # M3 second run
  f1="$(fp "$K")"; msg="$(runmsg "$K" $M/009_calls.sql)"; f2="$(fp "$K")"
  expect "M3 second run refused" "$(echo "$msg" | grep -o ALREADY_APPLIED | head -1)" "ALREADY_APPLIED"
  expect "M3 database unchanged" "$f2" "$f1"
  # M4 wrong order
  K="m_order_$mode"; fresh "$K" "$mode"; upto "$K" 7
  f1="$(fp "$K")"; msg="$(runmsg "$K" $M/009_calls.sql)"; f2="$(fp "$K")"
  expect "M4 009 before 008 refused" "$(echo "$msg" | grep -o MISSING_PREVIOUS | head -1)" "MISSING_PREVIOUS"
  expect "M4 database unchanged" "$f2" "$f1"
  # M5 failure in the middle -> everything rolled back; the real file afterwards works
  K="m_fail_$mode"; fresh "$K" "$mode"; upto "$K" 8; seed "$K"
  inject_failure $M/009_calls.sql
  f1="$(fp "$K")"; if run "$K" "$TMPD/broken.sql"; then expect "M5 broken file must fail" "applied" "refused"; fi; f2="$(fp "$K")"
  expect "M5 rolled back completely" "$f2" "$f1"
  run "$K" $M/009_calls.sql || { say "  FAIL real 009 after rollback"; cat "$TMPD/err"; exit 1; }
  expect "M5 real 009 afterwards" "$(hc "$K")" "21 of 21 checks passed"
done

# H1: a database with 001-008 only (production today) - the health check runs without error and reports exactly the 009 items
say "[health check before 009]"
K=m_h8; fresh "$K" supabase; upto "$K" 8
# rows 1-5 (tables, views, functions, triggers, indexes of 009), 9 (view permissions of 009), 13 (009 functions), 16 (009 checks)
expect "H1 001-008 result" "$(hc "$K")" "13 of 21 checks passed"
expect "H1 001-008 failing rows" "$(hcf "$K")" "1 2 3 4 5 9 13 16"

# M6: disposable database deleted (exact allowlisted name, marker verified) and rebuilt from scratch; tests pass again
say "[rebuild]"
$G drop main >/dev/null
expect "M6 main database gone" "$(printf '%s' "$($G verify main 2>&1 || true)" | grep -o 'verification query failed' | head -1)" "verification query failed"
bash tests/reset-db.sh main >/dev/null
expect "M6 rebuilt main: health" "$(hc main)" "21 of 21 checks passed"
$G drop main >/dev/null; $G drop main >/dev/null   # dropping an absent database is a no-op
bash tests/reset-db.sh main >/dev/null
expect "M6 rebuilt twice: health" "$(hc main)" "21 of 21 checks passed"

# clean-up: each scenario database by its exact key (no pattern)
for K in m_fresh_plain m_fresh_supabase m_up_plain m_up_supabase m_order_plain m_order_supabase m_fail_plain m_fail_supabase m_h8; do $G drop "$K" >/dev/null; done

if [ "$FAILS" -ne 0 ]; then say "migration tests: $FAILS FAILED"; exit 1; fi
say "migration tests: all passed"
