# Vioo Work R1A Task 6

Execute the approved spec sections 13–14 and R1A roadmap in the existing worktree,
main agent only, Supabase Cloud ftciqmqhmfvjtwoycswe. No handoff is part of this task.

- [x] Add a forward migration and failing Cloud rollback behavioral smoke.
- [x] Resolve current creator/assignments/participants and explicit mentions; never
  broadcast to permission holders. Apply user mute, mandatory action exceptions,
  routine cooldown and immutable event/user/channel deduplication.
- [x] Transactionally create in-app notifications and per-device push jobs. Recheck
  access/preferences at push claim, fence completion by lease token, recover stale
  leases, back off failures, quarantine exhausted retries and disable gone endpoints.
  External push is at-least-once across an ambiguous provider timeout; stable browser
  tags collapse retries, and successful devices are never intentionally retried.
- [x] Add bounded due-soon/overdue/ack-escalation events with daily dedupe. Resolve
  escalation via the existing strict current-manager resolver and require task view.
  Default due-soon is 60 elapsed minutes, routine cooldown 5 minutes, retry limit 8;
  these are delivery settings, not guessed company business-calendar data.
- [x] Guard Work rows in the shared notification table against technical-admin
  read bypass and authenticated fabrication/retargeting. Keep push content generic.
- [x] Publish an RLS-protected task revision signal; add feature-local invalidation
  subscription with reconnect/focus/poll refresh and canonical task/comment routing.
- [ ] Implement/deploy the internal Edge worker with the existing Vault/Edge internal
  secret; schedule a minute tick. A private enabled=false gate blocks automatic
  delivery until Task 10; no real users receive test messages.
- [ ] Run Cloud persona/worker regression, mocked transport/invalidation/route tests,
  lint/build, advisors and baseline audit; commit/dry-run/apply/postflight and record
  rollout evidence. Applied migrations remain immutable.
