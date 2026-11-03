# Publishing the web app

Deployment configuration is prepared in render.yaml. No cloud service has been created or charged by adding this file.

## Proposed deployment

- Render web service: business-workspace-lordyvites, deploying main from the GitHub repository.
- Node 24.22.1, a single 0.5c-512mb instance, and a 1 GB persistent disk mounted at /var/data for SQLite.
- HTTPS with secure session cookies. Render's documented RENDER_EXTERNAL_URL supplies the trusted origin; set APP_URL separately if using a custom domain.
- Public readiness check at /api/health verifies the database can respond without revealing account data.
- Build: npm ci --include=dev && npm run build. Start: node server/index.mjs.

Persistent storage is required: deploying this version on an ephemeral filesystem would lose accounts and records on restart or redeployment. Disk-backed services have interruptions during deployments and cannot be scaled horizontally with this SQLite design.

## Final deployment steps

1. Confirm the intended Render workspace and approve recurring hosting/storage costs before provisioning.
2. Review and apply the Blueprint in Render; complete GitHub authorisation and billing setup if Render requests them.
3. Monitor the deployment until live and verify the public URL, readiness, registration, sign-in and a saved record. Verify persisted data survives a redeploy before relying on storage.
4. New cloud accounts are separate from the local database. No local accounts or records are uploaded automatically.

This publishes the current development release as an online web app. Payments, public client portals and AI/media providers remain unavailable as documented in release-status.md. Full production launch still requires the account recovery, privacy/deletion and other launch work documented there.
