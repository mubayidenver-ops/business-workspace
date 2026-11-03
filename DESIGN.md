---
version: alpha
name: Business Workspace
description: A calm, connected workbench for independent businesses.
colors:
  primary: '#163d37'
  background: '#f6f8f7'
  surface: '#ffffff'
  ink: '#1e302b'
  muted: '#65736e'
  accent: '#d9edab'
  danger: '#a63030'
typography:
  sans:
    fontFamily: 'DM Sans, Segoe UI, sans-serif'
  display:
    fontFamily: 'Manrope, Bahnschrift, sans-serif'
  mono:
    fontFamily: 'Consolas, monospace'
rounded:
  DEFAULT: '12px'
  sm: '7px'
spacing:
  section-gap: '32px'
  page-max: '1600px'
components:
  button: {}
  card: {}
  dialog: {}
  input: {}
---

# Business Workspace design system

## Overview

The professional-workflow release adds a public marketing register in src/Welcome.tsx and src/pro.css, while preserving the existing workspace identity. Its signature is an illustrated Connect / Create / Deliver workflow; the public site uses no fabricated customer metrics. Shared client pages use document-like surfaces and a separate response panel. FinancialEditor, DocumentView, ShareModal, PublicPage and PasswordModal extend the canonical component system. Existing colors and type tokens remain authoritative.

### Creative North Star

A well-arranged studio tool cabinet: every instrument has a home, and related work sits together. Product register, not a sales landing page. The audience is freelancers and small agencies, serving international clients, as requested in docs/design.md.

English interface first. Dates, numbers and amounts follow the browser locale; dates without times remain date-only. Native date and select popups intentionally follow the operating system. No claim of Japanese localisation or country-specific commerce support.

The signature is the quiet stack of Create / Connect / Deliver tiles on the overview, reflecting a real client workflow. Everything around it prioritises reading and task clarity. Avoid neon dashboards, decorative revenue charts, fake activity and distracting animations.

## Colors

Runtime canonical model B: src/styles.css :root owns all semantic tokens. This document mirrors the accepted palette. Primary maps to --brand; background to --bg; surface to --surface; ink to --ink; muted to --muted; accent to --accent; danger to --danger. Components consume those variables. Group colours in the same stylesheet support wayfinding rather than communicate status. Statuses always have text. --focus supplies visible keyboard treatment. --thumb and --track supply global scrollbars. Forced colours use system controls.

## Typography

Manrope display headings, DM Sans body, system fallbacks with optional webfont swap to avoid late layout shift. Consolas for technical utility data where appropriate. Body baseline 14px with 1.5 line height; forms remain readable on mobile. Headings use restrained negative tracking, sentence case, no excessive bold. Monetary values have tabular numerals.

## Layout

236px forest sidebar, 80px white header, and a 36px desktop content inset. The overview has an asymmetric welcome / real-metrics layout and a four-column favourites grid. Tool library uses three columns, two on small screens, one below 380px. At 700px the sidebar becomes a dismissible drawer. Data tables own horizontal overflow; forms retain document scrolling. Content max width is 1600px. No full-screen ancestor clips long forms.

## Elevation & Depth

Thin borders define most surfaces. Only cards on hover, artwork and dialogs use shadows. No background gradients. The page uses a cool neutral background and white working surfaces.

## Shapes

--radius (12px) for panels, --control-radius (7px) for controls. Artwork uses deliberate slightly larger rounded tiles. Native select/date popup geometry is accepted.

## Components

Buttons have solid brand, outline neutral and reversible archive warning variants. Hover, pressed, disabled and visible focus styles are global. Busy labels preserve the interaction region. Lucide icons use 1.7px strokes, 16–26px sizes and text labels for actions; icon-only buttons have accessible names.

SearchBox, Modal, RecordEditor, Empty and Workbench are canonical primitives. Native dialog provides inert background and focus trapping. A single inline status banner acknowledges saves; form errors stay in their forms. Loading uses explicit text and an optional refresh spinner, never fake skeleton data.

## Motion

The shared DesignerCredit badge is visible on authentication and workspace pages, including mobile. It opens an accessible profile dialog with the supplied designer name, connected GitHub identity and confirmed project details. It uses the existing brand, surface and accent tokens; it does not include inferred personal information or workspace account data.

150ms colour and border changes; no entrance choreography. Reduced motion disables animation and transitions. Scrollbars remain visible with normal, hover, active and forced-colours behavior.

## Do's and Don'ts

- Do show genuine record counts and empty states.
- Do reuse the shared record editor and module registry.
- Don't suggest payments, publication, reminders or AI succeeded when no provider exists.
- Don't use a marketing hero or decorative charts inside a working tool.
