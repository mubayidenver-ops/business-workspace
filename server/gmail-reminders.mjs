export async function gmailAccessToken(config, send) {
  const response = await send('https://oauth2.googleapis.com/token', {
    method: 'POST',
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: config.refreshToken,
      grant_type: 'refresh_token',
    }),
    redirect: 'error',
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error('Gmail authorization failed. Check the sender credentials and token expiry.');
  }
  const { access_token: token } = await response.json();
  if (!token) throw new Error('Google did not return an access token.');
  return token;
}

export async function sendGmailReminder(message, token, send) {
  const mailbox = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+$/i;
  if (!mailbox.test(message.from) || !mailbox.test(message.to[0])) return false;
  const raw = [
    'From: ' + message.from,
    'To: ' + message.to[0],
    'Subject: ' + message.subject,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    Buffer.from(message.text).toString('base64').match(/.{1,76}/g).join('\r\n'),
  ].join('\r\n');
  const response = await send('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ raw: Buffer.from(raw).toString('base64url') }),
    redirect: 'error',
    signal: AbortSignal.timeout(10000),
  });
  await response.body?.cancel();
  return response.ok;
}
