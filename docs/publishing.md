# Publishing the web app

Deployment configuration is prepared in render.yaml. No cloud service has been created or charged by adding this file.

## Proposed deployment

- Render web service: business-workspace-lordyvites, deploying main from the GitHub repository.
- Node 24.22.1, a single Free instance and the existing DynamoDB table `bussiness-workspace` in `eu-north-1`. No persistent Render disk.
- HTTPS with secure session cookies. Render's documented RENDER_EXTERNAL_URL supplies the trusted origin; set APP_URL separately if using a custom domain.
- Public readiness check at /api/health verifies the database can respond without revealing account data.
- Build: npm ci --include=dev && npm run build. Start: node server/index.mjs.

Cloud records persist in DynamoDB independently of the Render filesystem. Secure server-side AWS access is required before deployment. See [DynamoDB setup](dynamodb.md), including the least-privilege policy template and TTL setting. Free hosting sleeps while idle, so scheduled monitoring pauses and the app may take time to wake up. Both providers have usage limits; a free plan is not an unlimited or guaranteed zero-cost production service.

## Final deployment steps

1. Configure a dedicated AWS identity limited to the table, and enable table TTL using the `ttl` attribute. Never use root access keys.
2. Review and apply the Blueprint in the intended Render workspace. Enter AWS credentials directly in its secret prompts; complete GitHub authorisation if requested. Do not paste credentials in chat or source code.
3. Monitor the deployment until live and verify the public URL, readiness, registration, sign-in and a saved record. Verify persisted data survives a redeploy before relying on storage.
4. New cloud accounts are separate from the local database. No local accounts or records are uploaded automatically.

This publishes the current development release as an online web app. Payments, public client portals and AI/media providers remain unavailable as documented in release-status.md. Full production launch still requires the account recovery, privacy/deletion and other launch work documented there.
