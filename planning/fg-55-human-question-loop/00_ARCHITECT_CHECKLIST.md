---
id: "fg-55"
title: "Human Question Loop and Notifications"
status: in_review
priority: "P1"
effort: "Large"
scope: "Both"
created: "2026-11-22"
updated: "2026-11-22"
pr: 195
branch: "feat/fg-55-human-question-loop"
depends_on: ["fg-30", "fg-33", "fg-41", "fg-54"]
---

# 00 — Human Question Loop and Notifications (fg-55)

> **Owns:** status, ticket map, deferred scope, user decisions.
> **Not here:** requirements (`01`), design (`02`), verification matrix (`03`),
> file operations (`04`).

**Related code:** `OpenCodeConfigWriter`, `OpenCodeClient`,
`HarnessTicketProcessor`, `HarnessRunService`, `HarnessEventService`,
`App.vue`, `TicketDetail.vue`.

## Why this ticket exists

Phase 1 runs OpenCode in blocking prompt mode and hardcodes `question: deny`
and `doom_loop: deny` (`OpenCodeConfigWriter.java:214-215`). The agent cannot
ask for a decision, so it either guesses or fails. There is no
`ticket_questions` or `notifications` table, no bell, and no way to suspend a
run, notify a human, accept an answer and resume.

This suite is the Phase 2 human loop that `fg-30` planned but left unticketed.
It also replaces the non-portable `doom_loop` permission with a supervisor-side
repetition policy that escalates to a question.

## Status evidence

| Claim | Evidence | Checked |
|---|---|---|
| Plan merged | #193 added this suite to master | ☑ |
| Implementation merged | pending review | ☐ |
| Verification results | `03` → Results (local: backend 152/1788, integration 19/141, agent 923, frontend 69/596 + 37 e2e) | ☑ |

## Deferred register (canonical)

Every deliberate omission and follow-up lives here exactly once. Status and
deferred scope are owned by this document; `01`–`04` link here.

| ID | Item | Source | Category | Follow-up | State |
|---|---|---|---|---|---|
| D1 | Email/Slack notification channels | fg-30 | UX | channel-adapter ticket | open |
| D2 | Realtime push (SSE/WebSocket) instead of 30s polling | self | UX | after the polling MVP | open |
| D3 | Durable suspend/resume across a supervisor restart while waiting | self | Reliability | durable-session follow-up | open |
| D4 | Question templates, saved answers and auto-answer policies | self | UX | after real usage | open |
| D5 | Multi-agent handoff questions (planner → worker) | fg-40 | Product | fg-40 | open |
| D6 | Per-project question policy, quiet hours and routing rules | self | Operations | after the global flag | open |
| D7 | Localization of question and notification text | self | UX | none | open |
| D8 | Attachments/screenshots in questions and answers | self | UX | none | open |
| D9 | Notification digest and retention tuning | fg-42 | Operations | fg-42 follow-up | open |
| D10 | Auto-continue on doom loop without asking (budget-only) | self | Autonomy | fg-52 policy | open |

## Decisions needed from the user

| # | Decision | Options | Recommendation | Answer |
|---|---|---|---|---|
| 1 | Alert channel | in-app bell / GitHub only / in-app + email | In-app bell + question inbox | Answered 2026-11-22: in-app bell + question inbox; email/Slack deferred (D1) |
| 2 | Waiting strategy | live wait / suspend and resume | Live wait with a bounded timeout; suspend is deferred (D3) | Answered 2026-11-22: live wait, `HARNESS_QUESTION_TIMEOUT_MINUTES` (60); durable suspend is D3 |
| 3 | Doom-loop default | ask after N repeats / auto-continue under budget | Ask after 3 repeats; budget and tool caps stay authoritative | Answered 2026-11-22: ask after 3 repeats (`HARNESS_DOOM_LOOP_MAX`), abort after 3 continues; auto-continue is D10 |
| 4 | Feature flag default | off / on | Off by default; enable per environment for the pilot | Answered 2026-11-22: `HARNESS_QUESTION_LOOP=false` by default; Phase 1 behavior when off |

## Completion gate

- [ ] Every `FR*`/`NFR*` acceptance statement in `01` is met
- [ ] Verification matrix in `03` is green and results are recorded
- [ ] `status` is `done` and the test evidence is linked
- [ ] Deferred register reflects what was actually left out
- [ ] No question or notification payload contains a secret
