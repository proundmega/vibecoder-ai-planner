SYSTEM_IMPROVEMENT_AGILE.md (Updated)
📝 Ticket Template (Copy-Paste Ready)
Código
ID: TKT-XXX
Title: [Short task title]
Description: [Detailed explanation of the task]
Acceptance Criteria: [Conditions for completion]
Priority: [High / Medium / Low]
Dependencies: [List ticket IDs this task depends on, e.g., TKT-002, TKT-003]
Status: Open
✅ Session Checklist (Updated)
Before starting any system improvement cycle, the agent must:

Request Information

Gather all necessary details about the feature.

Specifically ask if any tasks depend on others.

Create Tickets

Break down the feature into tasks.

Use the ticket template for consistency.

Ensure dependencies are clearly listed.

Store Tickets

Save all tickets in tickets.txt.

Read Tickets

Parse the file to understand tasks and dependencies.

Build a dependency graph if needed.

Process Tickets

Respect dependencies when updating statuses (a dependent ticket cannot move to In Progress until its prerequisites are Done).

Generate progress reports showing blocked vs unblocked tickets.
