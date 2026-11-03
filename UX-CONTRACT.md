# UX contract

## Product context and business sources

International freelancers and agencies. English interface with browser-local dates/numbers and local time-zone bookings. Accessibility target WCAG 2.2 AA; independent certification is not claimed.

| Domain                                       | Source                                      | Reviewed   |
| -------------------------------------------- | ------------------------------------------- | ---------- |
| Intended product and delivery sequence       | docs/design.md, approved in chat            | 2026-11-03 |
| Access, retention and development boundaries | docs/release-status.md                      | 2026-11-03 |
| Field validation and booking lifecycle       | server/validation.mjs and server/index.mjs  | 2026-11-03 |
| Billing and integration state                | shared/tools.mjs and docs/release-status.md | 2026-11-03 |

Visual context: DESIGN.md. Runtime token source: src/styles.css. Light theme only. Native date and select OS popup geometry/language are intentionally accepted in this initial English release.

## Canonical UI Map

| Capability     | Canonical owner                                  | Source of truth                        | Allowed variants         | Verification            |
| -------------- | ------------------------------------------------ | -------------------------------------- | ------------------------ | ----------------------- |
| Select/Listbox | native select in RecordEditor/Workbench          | this contract                          | native                   | browser keyboard        |
| Date           | RecordEditor native date/time input              | this contract                          | native                   | booking API and browser |
| Form           | RecordEditor in src/ui.tsx; Auth in src/main.tsx | shared/tools.mjs and server validation | create/edit/auth         | browser + API           |
| Scrollbar      | src/styles.css global baseline                   | DESIGN.md                              | geometry exceptions only | computed browser styles |
| Toast          | status-banner in src/main.tsx                    | this contract                          | success/info/error       | live-region browser     |
| CRUD           | RecordEditor and API                             | this contract                          | return to owning list    | integration + browser   |

## Dataset navigation

The local development API supports a maximum of 1,000 records per account; lists paginate 10 rows. Search/filter/page changes clamp the page. Tool library search/category/view persist in URL. Record queries and pagination are transient, deliberately not shareable because they can include client names. Server pagination is required before removing the development cap. Tables use native semantics. No bulk selection is offered.

## Flow ledger

| Operation          | Pending                                     | Success                                   | Failure and focus                                               |
| ------------------ | ------------------------------------------- | ----------------------------------------- | --------------------------------------------------------------- |
| Create/edit        | editor remains open, duplicate save blocked | close editor, refresh list, status banner | preserve values, inline error; return focus to trigger on close |
| Archive/restore    | confirmation stays open                     | refresh list; reversible archive          | preserve confirmation and show error                            |
| Search             | synchronous local filtering                 | reset/clamp page; clear button            | explicit no results                                             |
| Website check      | disable simultaneous check buttons          | show actual check result                  | show failed/blocked result; never invent uptime                 |
| File utility       | explicit processing state                   | browser download                          | in-panel error; retain input                                    |
| Cancel edited form | unsaved-change confirmation                 | discard only after explicit action        | keep editing; beforeunload guards browser navigation            |

## Forms, overlays and feedback

Professional workflow additions: sharing is an explicit publish action requiring an owner checkbox confirmation. ShareModal uses the existing Modal primitive, with expiry, copy/preview and confirmed revocation. PublicPage receives only a whitelisted document projection. Responses consume the link once. FinancialEditor owns line-item entry; DocumentView owns document display/print. Server totals are authoritative. PasswordModal masks all secrets, requires the current password, and redirects to sign-in after revoking existing sessions. See docs/pro-upgrade.md for the data and security contract.

Product forms disable native validation bubbles. Required fields, semantic types and field associations remain. Errors have live regions and field help references. Native dialog owns focus trap, Escape and inert background. Restore trigger focus on close. Reversible archive uses warning emphasis and a Cancel-first confirmation. There is no permanent record deletion UI. Private record retention is described in docs/release-status.md; do not infer a legal retention commitment.

Secret inputs are masked with a show/hide button. No secrets are persisted in browser storage. Favourites only use local storage. Textareas use resize:none and adequate height. SearchBox owns clear-and-refocus. Single-select native controls and date/time native pickers are accepted platform variants.

## Async and resilience

Writes are pessimistic. Version checks reject stale edits. API requests time out. Refresh preserves list data. Failed editor mutations preserve input; users can reopen stale records. Background refresh is informational, not an autosave. No offline editing or cloud sync is promised. File utilities are intentionally ephemeral: download outputs before leaving. Critical errors remain inline; save acknowledgements remain dismissible in the shared status banner.

## Navigation and responsive behavior

Named page titles, skip-to-content, text breadcrumbs, back-to-group controls, and a mobile sidebar drawer. List/detail editors share consistent semantics. Tables scroll horizontally on narrow screens. Dialog bodies scroll and actions stay reachable. Public deployment is not performed by this release.

## Verification

Run npm test, npm run build, and the premium static audit. Browser coverage should include authentication, create/edit/archive/restore, invalid inputs, search/no-results/clear, CSV, narrow layout and keyboard dialog closure. Compare onboarding and proposals as sibling record workflows. Tests and verification reports document actual results; missing browser checks are release risks rather than inferred passes.
