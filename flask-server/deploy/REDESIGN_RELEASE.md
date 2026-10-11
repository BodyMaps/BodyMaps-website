# Releasing the authenticated website redesign

Keep the redesign local until the reviewed preview is approved. Release the
merged code from `main`, preserving the current mount guard, watchdog, unified
case numbering and CancerVerse masks. Do not copy an old frontend/backend tree
over the live checkout.

## Before deployment

1. Review the actual nginx and edge-cache configuration. Keep dataset aliases
   internal, preserve private/no-store API headers, and purge old shared API
   cache entries. Apply the exact avatar upload location from
   `nginx-bodymaps.conf`, validate with `nginx -t`, then reload during the agreed
   release window. See `PROFILE_PICTURES.md`.
2. Confirm a consistent backup of the account database, stable `SECRET_KEY`,
   production Secure session cookies, and the existing Google/GitHub callback
   configuration. Run `alembic upgrade head` before starting the new backend:
   `a0c94f83b7d2` adds account pictures and `b72e86dc109a` adds nullable inference
   pipeline metadata. Existing accounts, sessions and completed jobs are retained.
3. Arrange restart access for **both** Flask and the separate Live Rooms
   WebSocket process. Restarting only Flask leaves the old WebSocket access
   rules active. Check the actual service manager and interpreter on this host;
   do not use a broad `pkill` or assume the example systemd unit is installed.
4. Follow [the processing pipeline runbook](../../docs/processing-pipeline.md)
   to stage the actual OpenVAE checkpoint and verify all selected stages on an
   isolated GPU run. File/runtime availability is a preflight, not proof that a
   real model ran successfully. Missing weights must remain visibly unavailable;
   do not enable a substitute reconstruction model or skip a requested stage.

## Required Live Rooms restart hook

`deploy.sh` requires `BODYMAPS_LIVE_ROOMS_RESTART_HOOK` to name an executable
operator-owned file. This is an explicit release prerequisite, including for
`deploy.sh check`; it is not an automatic sudo or process-discovery fallback.
The file accepts exactly one argument:

- `check`: verify that the expected service and restart authorization exist,
  without restarting, writing configuration or prompting for a password.
- `restart`: restart that exact service using its configured service manager
  and return nonzero if the restart fails.

For the system service described in `LIVE_ROOMS.md`, an administrator can
prepare a root-owned executable like this after verifying the unit paths:

```bash
#!/bin/bash
set -eu
case "${1:-}" in
  check)
    systemctl cat bodymaps-live-rooms.service >/dev/null
    sudo -n -l /usr/bin/systemctl restart bodymaps-live-rooms.service >/dev/null
    ;;
  restart) sudo -n /usr/bin/systemctl restart bodymaps-live-rooms.service ;;
  *) exit 2 ;;
esac
```

The administrator grants only the required command through their normal
authorization process. If Live Rooms uses a user service or another supervisor,
the operator supplies the corresponding two operations instead. A host that
does not run Live Rooms needs a separately reviewed deployment plan; do not use
a no-op hook to bypass this prerequisite.

Set `BODYMAPS_LIVE_ROOMS_RESTART_HOOK` to that file before running the README's
deployment command. `BODYMAPS_LIVE_ROOMS_URL` defaults to
`http://127.0.0.1:8001`; change it only to the confirmed local service address.
`deploy.sh check` calls only the hook's read-only `check` operation and exits
before locks, backup, build, migration or restarts.

## Automated release verification

The deployment preserves the existing inference-job wait. Only HTTP 404 from a
legacy backend deliberately permits deployment without a job count; timeout,
401/403, other unexpected statuses or an invalid count stop the deployment.
`GET`/`HEAD /api/health` remain public and read cached operational state, so the
watchdog never needs a browser session.

After restarting both services, checks require a healthy WebSocket process and
an HTTP 401 for an anonymous WebSocket upgrade. The script verifies anonymous
dataset denial, then uses its existing disposable test account for search,
mask HEAD requests and plan checks, and logs that session out. No full scan is
downloaded. If storage is degraded, mask verification is explicitly reported as
unavailable and must be repeated after recovery.

Finish in the approved Chrome profile: sign in through the existing providers,
browse both datasets, open a PanTS and CancerVerse case, check masks, reports,
uploads, account picture persistence and Live Rooms. Confirm logout blocks
protected pages and invalidates an open room connection. Repeat with the
optional Keep me signed in setting. This browser review is required in addition
to script checks.

If rollback is needed, leave the additive avatar table in place. Roll back and
restart both application processes together and rebuild/restore the matching
frontend; a backend-only restart is not a complete release rollback.
