# Interview scheduling for the ATS (book / reschedule / cancel / complete)

Adds an end-to-end interview module on top of the existing ATS: a recruiter opens a shortlisted candidate, picks a panel and a time slot, and the backend books it inside a transaction — advancing the application to INTERVIEWING, creating an external calendar event through a pluggable provider (Google / Teams / manual), writing an audit event, and firing invite emails. Availability slots are computed from working hours minus the panel's existing bookings, with DST handled through built-in `Intl` rather than a tz library. Visibility reuses the job-ownership scoping: recruiters see only their own jobs' candidates, org admins see everything. The frontend is a zoneless Angular signals component driving a schedule modal.

Watch for: a **confirmed** schedule-time failure — the organizer participant is built from `req.user.email`/`first_name`, but the auth middleware only populates `req.user = { id, uuid }`, so every booking either persists a bogus `organizer@unknown` email or fails the participant `isEmail` validation and rolls back the whole transaction. Also **confirmed**: the conflict/availability query loads *all* active interviews for the panel across all time (no date bound), the external provider call runs *inside* the DB transaction holding a row lock, and the schedule/reschedule paths issue redundant reloads. Timezone/DST handling and the row-lock booking design are sound.

**Verdict**: NEEDS_CHANGES

## High-level view

The booking path locks the parent application row, re-checks interviewer conflicts against a fresh busy list inside the transaction, then commits — so two recruiters racing the same slot is handled. The weakness is that the external calendar HTTP call (Google/Teams, up to a 15s timeout) happens *inside* that transaction while the row lock is held, so a slow provider pins a DB connection and blocks anyone else touching that application.

The organizer participant is assembled from fields the auth layer never sets (`req.user.email`, `req.user.first_name`). Because `InterviewParticipant.email` validates as an email, `organizer@unknown` fails validation and aborts the transaction — scheduling is broken until this is fixed or verified against the real middleware.

Conflict detection and availability both call `busyWindowsForUsers`, which selects every active interview a panel member has ever had, with no time bound — correct but unbounded in an interviewer's history, and the supporting index is on `(organization_id, scheduled_start)`, not on the participant→interview join the query actually drives through.

Visibility scoping is tenant-safe and consistent with the existing application module. One asymmetry: the interviewer directory and availability scope to the *application's* org, but `resolveInterviewers` validates uuids against the *caller's* org — for a super-admin acting cross-org these diverge, letting the panel and the resource belong to different tenants.

The frontend uses methods (not computeds) for form-derived flags, avoiding the stale-computed trap. The friction is redundant network work: scheduling triggers an interview reload, a full application refetch, and a list reload in sequence, and interviewer options are cached per component with no refresh.

<details>
<summary>Issues (11)</summary>

1. **Organizer participant identity is never populated (confirmed)** — `scheduleInterview` reads `req.user.email`/`first_name`/`last_name`, but `authVerify` sets only `req.user = { id, uuid }`. `email` falls back to `'organizer@unknown'`, which fails `InterviewParticipant`'s `isEmail` validation and rolls back the booking. Load the organizer's real record (or carry email/name in the token) before creating the participant row.
2. **Provider HTTP call inside the locked transaction (confirmed)** — `provider.createEvent` / `updateEvent` (external HTTP, up to 15s) run inside `sequelize.transaction` while the application row is `FOR UPDATE` locked. Move the external call outside the transaction (book as manual, commit, then enrich with the external event id in a follow-up update).
3. **Unbounded conflict/availability query (confirmed)** — `busyWindowsForUsers` selects all active interviews for the panel with no time window. Constrain to `scheduled_end >= rangeStart AND scheduled_start <= rangeEnd` (and to the slot window on the schedule path) so the scan stays proportional to the query range, not the interviewer's lifetime history.
4. **Conflict query isn't index-aligned (likely)** — the query filters `interviews` by `(organization_id, status)` then joins `interview_participants` on `user_id`. Add a composite index such as `interview_participants(user_id, interview_id)` and consider `interviews(organization_id, status, scheduled_start)` to support the windowed lookup.
5. **Cross-org panel/resource divergence for super-admin (likely)** — availability/directory scope to `application.organization_id`, but `resolveInterviewers` constrains to `req.auth.organizationId` (skipped entirely for super-admins). Resolve interviewers against `application.organization_id` so the panel can't belong to a different org than the interview.
6. **Redundant post-schedule network churn (confirmed)** — `submitSchedule` calls `loadInterviews`, then `getApplication`, then `list.reload()` back to back. Reuse the interview returned by `schedule()` and the application it already advances, or collapse to a single refresh.
7. **Reschedule/cancel/complete reload the row twice (confirmed)** — each path saves inside the transaction, then re-runs `Interview.findByPk` (for notify) and `Interview.findOne` with full includes after commit. Return the already-loaded instance from the transaction and reuse it.
8. **Teams reschedule doesn't move the meeting (likely)** — `teams.updateEvent` returns the existing event unchanged when an id is present, so a rescheduled Teams interview keeps its original time server-side; only the email communicates the change. Confirm this is the intended trade-off or issue a real Graph update.
9. **`interview_number` sequence is race-prone at scale (likely)** — `nextSequenceCode` does `MAX(id)+1`; concurrent bookings can compute the same number and collide on the unique constraint (one booking fails). Acceptable as a rare retryable error, but flag it since the whole point of the txn is concurrency safety.
10. **Availability offers slots down to "now + nothing" (possible)** — `generateSlots` filters `slotStart < now`, so a slot can be returned that starts one granularity step from now. If a minimum lead time is expected before an interview, it isn't enforced. Verify.
11. **Interviewer options cached with no refresh (possible)** — `loadInterviewers` only fetches when `interviewerOptions().length === 0`, so a newly added org user never appears without a full reload. Minor; confirm the directory is expected to be static within a session.

</details>

<details>
<summary>Details</summary>

### Organizer participant is built from fields the token never carries

`scheduleInterview` creates the organizer row like this:

```js
email: req.user?.email || 'organizer@unknown',
name: [req.user?.first_name, req.user?.last_name].filter(Boolean).join(' ').trim() || null,
```

`authVerify` documents and sets `req.user = { id: decoded.sub, uuid: decoded.uuid }` — no `email`, no name. So `req.user.email` is always undefined and the code takes the `'organizer@unknown'` fallback on every booking. `InterviewParticipant.email` declares `validate: { isEmail: true }`, and `organizer@unknown` is not a valid email, so the `bulkCreate` throws inside the transaction and the entire booking rolls back. Either way the organizer is never a usable invitee. Load the organizer's `User` (email + name) in the transaction, or extend the token/`req.user` to carry them. This is the one issue that blocks the feature outright, so it needs a fix or an explicit trace against the deployed middleware.

### The calendar provider call runs while the application row is locked

The booking opens a transaction, locks the application `FOR UPDATE`, re-checks conflicts, creates the interview + participants, and then:

```js
providerOut = await provider.createEvent(buildProviderContext(...));
```

Google and Teams are real network calls with a 15s configured timeout. Holding a `FOR UPDATE` lock on the application (and a pooled DB connection) across that call means a slow or degraded provider serializes every other operation on that application and drains the connection pool under load. The rest of the design deliberately minimizes lock time — interviewers are resolved before the transaction — so this is the one place the pattern breaks. The safer shape is to commit the booking as manual (row + participants + audit + status advance), then perform the external call after commit and patch `external_event_id` / `meeting_url` in a short follow-up write. That also removes the case where the provider succeeds but a later statement in the transaction fails, leaving an orphaned external event.

### Conflict detection scans the whole history of each interviewer

Both availability and the commit-time conflict check go through:

```js
const rows = await Interview.findAll({
  where: { organization_id, status: { [Op.in]: INTERVIEW_ACTIVE_STATUSES } },
  include: [{ model: InterviewParticipant, as: 'participants', required: true,
             where: { user_id: { [Op.in]: userIds } } }],
});
```

There is no bound on `scheduled_start` / `scheduled_end`. Every active interview a panel member has ever had is loaded to answer "are they free in this window?" For a busy interviewer this set grows without limit, and the availability endpoint runs it for a window that's already known (`rangeStart`/`rangeEnd`). Add a time predicate — `scheduled_end >= rangeStart AND scheduled_start <= rangeEnd` for availability, and the `[start-buffer, end+buffer]` window for the schedule/reschedule conflict check — so the query cost tracks the requested range instead of the interviewer's tenure.

The index story compounds it. `interviews` indexes `(organization_id, scheduled_start)`, but this query filters `interviews` by `(organization_id, status)` and joins `interview_participants` on `user_id`, with the time filter (once added) on `scheduled_start`/`scheduled_end`. The participant side has a plain `user_id` index; the driving lookup would benefit from `interview_participants(user_id, interview_id)` and an `interviews(organization_id, status, scheduled_start)` composite so the join and the window are both index-served.

### Visibility scoping is tenant-safe, with one cross-org seam

`findVisibleApplication` and `findVisibleInterview` apply `req.tenantWhere` then re-check `buildJobScope`'s `created_by_id` against the resource's job owner, so a recruiter can't reach another recruiter's candidate and an org admin sees the whole org. Gating the interviewer directory on `interview.create` rather than `user.read` lets a recruiter assemble a panel without the Users module — a deliberate choice.

The seam is org derivation. `getAvailability` and `listInterviewers` scope to `application.organization_id` (derived from the resource), but `resolveInterviewers` scopes candidate users to `req.auth.organizationId` and skips that filter entirely for super-admins. For an org-scoped caller these coincide; for a super-admin operating on an application in org A, `resolveInterviewers` will accept uuids from org B, so the panel and the interview can belong to different orgs. Resolve interviewers against `application.organization_id` regardless of caller scope.

### Timezone / DST handling holds up

Answering the direct question: DST is handled correctly. `zonedWallTimeToInstant` computes the zone offset per instant and re-checks it after the first correction, so working-hours ("09:00") map to the right absolute instant across a DST boundary; the day cursor advances via "next day at noon" to avoid the midnight-skip edge. Times are stored as absolute UTC with `timezone` as display metadata. The `safety < 400` day cap and `MAX_SLOTS_RETURNED` bound keep slot generation from running away.

### Frontend: form-derived flags are methods, re-fetching is the weak point

`needsManualLink()` and `needsLocation()` are methods reading `scheduleForm.getRawValue()`, not `computed()`s — the right call, since a reactive form value isn't a signal and a computed would latch on first read and go stale when the dropdown changes. The comment on `needsManualLink` shows the author already hit and understood that trap.

The cost is redundant work after a booking. `submitSchedule` runs `loadInterviews(app.uuid)`, then a fresh `getApplication(app.uuid)`, then `list.reload()` — three round-trips where the `schedule()` response already returns the created interview and the booking already advanced the application. Reuse those payloads or collapse to one refresh. The backend reschedule/cancel/complete paths similarly reload the interview twice post-commit (once by pk for the email, once with full includes for the response) instead of reusing the instance already saved inside the transaction.

</details>

<details>
<summary>File map</summary>

- `src/services/ats/interview.service.js` — core booking/reschedule/cancel/complete logic; organizer bug, in-txn provider call, unbounded busy query live here.
- `src/services/ats/scheduling/availability.js` — Intl-based tz/DST slot generation + conflict check.
- `src/services/ats/calendar/{provider.registry,google.provider,teams.provider,manual.provider}.js` — pluggable providers + manual fallback; Teams reschedule is a no-op update.
- `src/models/interview.model.js`, `interview-participant.model.js` — schema + indexes (missing the participant→interview composite for conflict lookups).
- `src/config/{calendar,query-configs,rbac}.js` — provider config, interview query allow-list, interview permissions.
- `src/controllers/ats/interview.controller.js`, `src/validations/ats/interview.validation.js`, `src/routes/v1/{interview,application}.route.js` — HTTP surface + Joi shapes + permission gating.
- `src/utils/ats.constants.js`, `src/locales/en.json`, `src/services/email/templates/index.js` — domain constants, messages, invite templates.
- `wms-admin-frontend/.../job-detail.ts` / `.html` / `interviews.scss` — schedule modal + interview list; method-based form flags, redundant refetches.
- `wms-admin-frontend/.../services/interviews.service.ts`, `models/ats.model.ts`, `core/constants/api-endpoints.ts` — FE data access + types.

Full diff: `git diff origin/main..HEAD` (commit `867e09b`).

</details>
