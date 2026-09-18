# Rotating `VITE_STORYFORGE_TOKEN` — prepared 2026-09-18, not executed

**Status: ready to run. Nothing in this document has been done.** It was written overnight
while Jonathan was asleep, deliberately stopping short of execution: rotating the token
without him awake would black out the family's app mid-flight, and the app is the thing
Keen reads at breakfast.

---

## The thing to understand before anything else

**A `VITE_` variable is not a secret and cannot be made into one.**

Vite substitutes `import.meta.env.VITE_*` at **build** time. The value is compiled into the
JavaScript bundle and served, in plain text, to every browser that ever loads the app. Open
the deployed site, view source, and it is there. This is not a misconfiguration to fix — it
is what the prefix *means*. `VITE_` is Vite's marker for "safe to publish", and anything
put behind it is published.

So:

- The current token has been public since the day the app first deployed, to everyone who
  loaded it.
- It has *also* sat in `.env`, tracked in this **public** repo, since **2026-08-22**
  (`f1dc1b6d`, "fix: send scoped Storyforge token on every Ability call"). That is a second
  copy of an already-public value, **not a second secret**.
- **Rotating it changes nothing durable.** The new value is published by the same
  mechanism the moment the new bundle ships.

The server already says this, in `main.py` around line 1685, and acted on it: the scoped
token's *authority* was cut down on 2026-09-17 rather than its secrecy defended.
`STORYFORGE_SCOPE_DENIED_COMMANDS` now refuses `storyforge.universe.delete.v1`,
`story.delete.v1`, `chapter.delete.v1`, `conversation.turn.redact.v1`, `living.notes.set.v1`
and `migrate.v1` to any caller presenting it.

**Therefore: rotation is hygiene, not a fix. The fix is step 3 — per-user sessions.**
Do not let a completed rotation close this out.

---

## Step 0 — what is true right now

| | |
|---|---|
| `.env` | **tracked**, public repo, holds `VITE_ABILITY_URL` and `VITE_STORYFORGE_TOKEN` |
| `.gitignore` | ignores `.env.local`, **not** `.env` |
| token resolution | `src/main.jsx:32` — `localStorage.getItem("storyforge_token")` **first**, then `import.meta.env.VITE_STORYFORGE_TOKEN` |
| server | accepts a **list**: `STORYFORGE_APP_TOKENS` (comma-separated) or `STORYFORGE_APP_TOKEN` (single) |
| scope | `story.*` / `storyforge.*` prefix, minus the denied set above |

Two of those are the whole reason this can be done without an outage:

1. **The server takes several tokens at once.** `_resolve_storyforge_app_tokens()` exists
   precisely so "a rotation is not an outage" — old and new are both live while the rebuilt
   bundle rolls out.
2. **The client prefers `localStorage`.** A device can be moved onto a new token *before*
   any build changes, and moved onto a per-user session later, without a redeploy.

---

## Step 1 — the rotation (≈10 minutes, one word to start)

Run in daylight, with someone able to load the app and confirm. Not mid-reading.

```bash
# 1. Mint. 32 bytes, url-safe.
NEW=$(python3 -c 'import secrets; print(secrets.token_urlsafe(32))')

# 2. Both values live at once. OLD is the current VITE_STORYFORGE_TOKEN.
gcloud run services update ability-supervisor-service \
  --region=us-central1 --project=beaming-opus-481400-t9 \
  --update-env-vars="STORYFORGE_APP_TOKENS=${NEW},${OLD}"

# 3. Confirm BOTH are accepted, before touching the client.
for T in "$NEW" "$OLD"; do
  curl -sS -X POST https://ability-supervisor-service-818269465014.us-central1.run.app/v1/execute \
    -H "Authorization: Bearer $T" -H 'Content-Type: application/json' \
    -d '{"capability":"storyforge.universes.list.v1","args":{"tenantId":"core","userId":"jonathan"}}' \
    | python3 -c 'import sys,json; print(json.load(sys.stdin).get("ok"))'
done
# expect: True, True
```

Then the client: set `VITE_STORYFORGE_TOKEN=$NEW` in `.env`, commit, deploy, and confirm
`/version.json` reports the new `gitSha` **before** step 4 — merged is not deployed, and
this repo has taught that three times.

```bash
# 4. Only after the new bundle is confirmed live. Drop the old value.
gcloud run services update ability-supervisor-service \
  --region=us-central1 --project=beaming-opus-481400-t9 \
  --update-env-vars="STORYFORGE_APP_TOKENS=${NEW}"
```

**Rollback at any point:** put `${OLD}` back in `STORYFORGE_APP_TOKENS`. Every device that
still has the old bundle cached keeps working; nothing needs reinstalling.

**Do not** skip step 2 and set the new value alone — every phone, iPad and home-screen
install runs a *cached* bundle, and they will 401 until each one is force-refreshed. That is
the blackout this sequencing exists to avoid.

---

## Step 2 — `.gitignore` (done in this change, and it is not enough)

`.env` is added to `.gitignore` here. **On its own that does nothing**: git keeps tracking a
file it already tracks. To actually stop publishing it:

```bash
git rm --cached .env
git commit -m "chore: stop tracking .env"
```

Not done here, because `.env` also carries `VITE_ABILITY_URL`, and a clean checkout that
builds without it silently falls back to the hard-coded default in `src/main.jsx:30`. Untrack
it in the same change that adds a committed `.env.example` and confirms the deploy pipeline
supplies both variables. **Do not rewrite history to purge it** — the value is public
already, forks and clones have it, and the rewrite would cost more than it buys.

---

## Step 3 — the actual fix: per-user sessions (#1581)

#1581 landed the Apple sign-in exchange, and its capabilities are **live in production
today** (verified against `system.capability.list.v1`, 2026-09-18):

- `auth.storyforge.enroll.code.v1` — mint a one-time code binding a device to a profile.
  **Master scope only**, deliberately not reachable with the scoped app token.
- `auth.storyforge.session.whoami.v1` — what identity the server stamped on this request.
- `auth.storyforge.identity.list.v1` — linked identities and live sessions.
- `auth.storyforge.identity.revoke.v1` — revoke one identity, one session, or all of a profile's.

Migration, per device, no redeploy needed at any step:

1. Jonathan mints an enrollment code for that reader (`auth.storyforge.enroll.code.v1`,
   with `targetUserId`, from a master-scoped caller).
2. The device signs in with Apple, presenting the code once. It gets a session.
3. The session token is written to `localStorage.storyforge_token`, which `src/main.jsx:32`
   already prefers over the compiled-in value. **The device is now on per-user auth and the
   shared token is unused on it.**
4. When every device has a session: drop `VITE_STORYFORGE_TOKEN` from `.env` entirely and
   clear `STORYFORGE_APP_TOKENS` on the service. The shared token stops existing rather than
   being rotated again.

What this buys that rotation does not: revocation per device, an identity on every write
(so `madeBy` stops being a guess), and a token that was never published to begin with.

**Blocked on:** #1581's device sign-in needs Jonathan's face on the phone — it is on the
excluded list for exactly that reason. Steps 1 and 2 do not wait for it.

---

## Order, if you want one line

1. `.gitignore` + this document — **done, in this change.**
2. Rotate, in daylight, two-value first — **one word, ~10 minutes.**
3. Untrack `.env` alongside a committed `.env.example` — small, needs one decision.
4. Enroll each device onto a session; then delete the shared token rather than rotating it
   a third time.

Steps 2 and 3 are worth doing and change nothing about who can read the token. Only step 4
does.
