# Implementation plan — approved design

1. Establish the React/TypeScript app, shared module registry, accessible primitives and design contracts.
2. Build a real single-user-per-workspace authentication and persistent SQLite API for local operation. PostgreSQL, team invitations and object storage remain deployment upgrades, not implied capabilities.
3. Implement all 30 module workspaces with typed field definitions, validated records, archive/restore and export. Add working dedicated utilities for CSV, PDF, images, captions, quizzes, language exercises, catalogues and content drafts.
4. Add safe website checks and scheduled in-app due notifications. Clearly label integrations not configured and do not simulate payment or media processing.
5. Verify API isolation, validation, conflict handling, CSV parsing and browser flows; build production assets.
6. Commit and push the reviewable first release and document remaining production capabilities.

The target is a working development release spanning the catalogue, not a claim that all paid integrations are launched. No deployment or paid service is purchased.
