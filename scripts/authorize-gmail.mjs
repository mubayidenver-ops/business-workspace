import { createHash, randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';

const [credentialsFile, outputFile] = process.argv.slice(2);
if (!credentialsFile || !outputFile) {
  throw new Error('Usage: node scripts/authorize-gmail.mjs <desktop-client.json> <new-private-env-file>');
}
const { installed } = JSON.parse(await readFile(credentialsFile, 'utf8'));
if (!installed?.client_id || !installed.client_secret) throw new Error('Use a Desktop app JSON file.');
const verifier = randomBytes(32).toString('base64url');
const state = randomBytes(32).toString('base64url');
const server = createServer();
try {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const redirect = 'http://127.0.0.1:' + server.address().port;
  const authorization = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  authorization.search = new URLSearchParams({
    client_id: installed.client_id,
    redirect_uri: redirect,
    response_type: 'code',
    scope: 'https://www.googleapis.com/auth/gmail.send',
    access_type: 'offline',
    prompt: 'consent',
    state,
    code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    code_challenge_method: 'S256',
  });
  const code = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Authorization timed out.')), 300000);
    server.on('request', (req, res) => {
      const params = new URL(req.url, redirect).searchParams;
      const code = params.get('code');
      if (params.get('state') !== state) {
        res.writeHead(404).end();
        return;
      }
      clearTimeout(timeout);
      res.end(code ? 'Authorization received. Return to your terminal.' : 'Authorization declined.');
      if (code) resolve(code);
      else reject(new Error('Google authorization declined.'));
    });
    console.log('Open this URL in your browser and select your sender mailbox:\n' + authorization);
  });
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    body: new URLSearchParams({
      client_id: installed.client_id,
      client_secret: installed.client_secret,
      code,
      code_verifier: verifier,
      redirect_uri: redirect,
      grant_type: 'authorization_code',
    }),
    redirect: 'error',
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error('Google token exchange failed.');
  const { refresh_token: token } = await response.json();
  if (!token) throw new Error('Google did not return a refresh token.');
  await writeFile(outputFile, 'GMAIL_REFRESH_TOKEN=' + token + '\n', { flag: 'wx', mode: 0o600 });
  console.log('Refresh token saved to your private output file. Enter it directly in Render.');
} finally {
  server.close();
}
