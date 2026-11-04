import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { validateRecord } from './validation.mjs';
import { newSecret, otpauthURL, verifyTotp, newRecoveryCodes, useRecoveryCode } from './totp.mjs';
import { validateAvailability, availableSlots } from '../shared/availability.mjs';

export const roles = ['owner', 'admin', 'member'];
const rank = { member: 1, admin: 2, owner: 3 };
export const pageKinds = ['feedback', 'testimonials', 'help', 'status', 'booking'];
const publicFeedback = ['Active', 'In review', 'Completed'];
const published = ['Active', 'Completed'];
const cookie = (name, value, maxAge) =>
  `${name}=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${process.env.COOKIE_SECURE === 'true' ? '; Secure' : ''}`;
export const clearSession = [cookie('bw_session', '', 0), cookie('bw_workspace', '', 0)];
const data = (r) => (typeof r.data === 'string' ? JSON.parse(r.data) : r.data);
const hex = (v, n = 64) => typeof v === 'string' && new RegExp(`^[a-f0-9]{${n}}$`).test(v);
const email = (v) =>
  String(v || '')
    .trim()
    .toLowerCase();

export function verifyPassword(profile, password) {
  const [salt, hash] = profile.password.split(':');
  return timingSafeEqual(scryptSync(String(password || ''), salt, 64), Buffer.from(hash, 'hex'));
}

export function createFeatures({ store, billing, fail, body, json, rate, sessionHash }) {
  const requireRole = (ws, role) => {
    if (rank[ws.role] < rank[role])
      throw fail(403, `Only workspace ${role === 'owner' ? 'owners' : 'owners and admins'} can do this.`);
  };
  const clean = (fn, input) => {
    try {
      return fn(input);
    } catch (e) {
      throw fail(400, e.message);
    }
  };

  /** Verifies an authenticator or recovery code and records it so it cannot be reused. */
  async function secondFactor(profile, code) {
    const security = profile.security || { version: 0 };
    if (!security.totp) return true;
    const step = verifyTotp(security.totp.secret, code, security.totp.lastStep ?? -1);
    let next;
    if (step !== null) next = { ...security, totp: { ...security.totp, lastStep: step } };
    else {
      const remaining = useRecoveryCode(security.recoveryCodes, code);
      if (!remaining) return false;
      next = { ...security, recoveryCodes: remaining };
    }
    await store.setSecurity(profile.email, security.version || 0, next);
    return true;
  }

  async function workspaceFor(req, user) {
    const id = /\bbw_workspace=([a-f0-9-]{36})/.exec(req.headers.cookie || '')?.[1];
    if (id && id !== user.id) {
      const m = await store.membership(id, user.id);
      if (m) return { id, name: m.workspaceName, role: m.role };
    }
    return { id: user.id, name: user.name, role: 'owner' };
  }

  async function workspaces(user) {
    const memberships = await store.memberships(user.id);
    return [
      { id: user.id, name: user.name, role: 'owner' },
      ...memberships.map((m) => ({ id: m.workspace_id, name: m.workspaceName, role: m.role })),
    ];
  }

  async function bookingPage(workspaceId) {
    const availability = await store.getSetting(workspaceId, 'availability');
    return availability ? validateAvailability(availability) : null;
  }

  async function createManageToken(workspaceId, recordId) {
    const token = randomBytes(32).toString('hex');
    await store.createBookingToken(workspaceId, recordId, sessionHash(token));
    return token;
  }

  async function publicPage(req, res, page) {
    const ws = page.workspace_id;
    const brand = page.brand;
    if (req.method === 'GET') {
      const { records, checks } = await store.state(ws);
      const live = records.filter((r) => !r.archived);
      const result = { kind: page.kind, brand };
      if (page.kind === 'feedback')
        result.requests = live
          .filter((r) => r.module === 'feedback' && publicFeedback.includes(r.status))
          .map((r) => ({ id: r.id, title: r.title, status: r.status, votes: r.votes || 0, notes: data(r).notes || '' }))
          .sort((a, b) => b.votes - a.votes);
      if (page.kind === 'testimonials')
        result.testimonials = live
          .filter((r) => r.module === 'testimonials' && published.includes(r.status) && data(r).consent === true)
          .map((r) => ({ client: data(r).client, notes: data(r).notes }));
      if (page.kind === 'help')
        result.articles = live
          .filter((r) => r.module === 'help' && published.includes(r.status))
          .map((r) => ({ id: r.id, title: r.title, category: data(r).category || 'General', notes: data(r).notes, updated: r.updated }));
      if (page.kind === 'status') {
        const day = Date.now() - 86400000;
        result.monitors = live
          .filter((r) => r.module === 'uptime' && r.status === 'Active')
          .map((r) => {
            const mine = checks.filter((c) => c.record_id === r.id);
            const recent = mine.filter((c) => Date.parse(c.created) >= day);
            const last = mine[0];
            return {
              title: r.title,
              ok: last ? !!last.result.ok : null,
              checked: last?.created || null,
              ms: last?.result.ms ?? null,
              uptime24h: recent.length
                ? Math.round((recent.filter((c) => c.result.ok).length / recent.length) * 1000) / 10
                : null,
            };
          });
        result.overall = result.monitors.some((m) => m.ok === false)
          ? 'degraded'
          : result.monitors.length
            ? 'operational'
            : 'unknown';
      }
      if (page.kind === 'booking') {
        const a = await bookingPage(ws);
        if (!a) throw fail(410, 'Online booking is not available right now.');
        Object.assign(result, {
          title: a.title,
          description: a.description,
          timezone: a.timezone,
          slotMinutes: a.slotMinutes,
          slots: availableSlots(a, records),
        });
      }
      json(res, 200, result);
      return;
    }
    if (req.method !== 'POST') throw fail(405, 'This action is not available.');
    rate('page-post:' + req.socket.remoteAddress + page.hash, 30);
    const input = await body(req);
    const name = String(input.name || '').trim();
    if (input.action === 'vote' && page.kind === 'feedback') {
      if (!hex(input.voter, 32)) throw fail(400, 'Reload the page and try again.');
      const record = await store.getRecord(ws, String(input.id || ''));
      if (!record || record.archived || record.module !== 'feedback' || !publicFeedback.includes(record.status))
        throw fail(404, 'This request is no longer on the board.');
      const counted = await store.publicVote(ws, record.id, sessionHash(record.id + ':' + input.voter));
      json(res, 200, { counted });
      return;
    }
    if (input.action === 'submit' && ['feedback', 'testimonials'].includes(page.kind)) {
      if (!name || name.length > 80) throw fail(400, 'Enter your name.');
      const notes = String(input.notes || '').trim();
      if (!notes || notes.length > 5000) throw fail(400, 'Write a message of up to 5,000 characters.');
      const record =
        page.kind === 'feedback'
          ? clean(validateRecord.bind(null, 'feedback'), {
              title: String(input.title || '').trim(),
              status: 'Draft',
              data: { client: name, notes },
            })
          : clean(validateRecord.bind(null, 'testimonials'), {
              title: `Testimonial from ${name}`.slice(0, 180),
              status: 'Draft',
              data: { client: name, notes, consent: input.consent === true },
            });
      await store.createRecord(ws, page.kind, record);
      json(res, 201, { received: true });
      return;
    }
    if (input.action === 'book' && page.kind === 'booking') {
      const a = await bookingPage(ws);
      if (!a) throw fail(410, 'Online booking is not available right now.');
      const guestEmail = email(input.email);
      if (!name || name.length > 80) throw fail(400, 'Enter your name.');
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(guestEmail) || guestEmail.length > 254)
        throw fail(400, 'Enter a valid email address.');
      const { records } = await store.state(ws);
      const start = String(input.start || '');
      if (!availableSlots(a, records).includes(start))
        throw fail(409, 'That time was just taken. Choose another slot.');
      const end = new Date(Date.parse(start) + a.slotMinutes * 60000).toISOString();
      const record = clean(validateRecord.bind(null, 'booking'), {
        title: `${a.title} — ${name}`.slice(0, 180),
        status: 'Active',
        data: {
          client: name,
          email: guestEmail,
          start,
          end,
          bufferMinutes: String(a.bufferMinutes),
          notes: String(input.notes || '').slice(0, 2000),
          offerSlot: false,
        },
      });
      const saved = await store.createRecord(ws, 'booking', record);
      const manageToken = await createManageToken(ws, saved.record.id);
      json(res, 201, { start, end, manageToken });
      return;
    }
    throw fail(400, 'This action is not available on this page.');
  }

  async function manageBooking(req, res, token) {
    if (!hex(token)) throw fail(410, 'This booking link is no longer valid.');
    const hash = sessionHash(token);
    rate('booking-manage:' + hash, 60);
    const link = await store.bookingToken(hash);
    const record = link && (await store.getRecord(link.workspace_id, link.record_id));
    if (!record || record.archived || record.status === 'Cancelled')
      throw fail(410, 'This booking was cancelled or is no longer available.');
    const d = data(record);
    const changeable = Date.parse(d.start) > Date.now();
    const a = await bookingPage(link.workspace_id);
    if (req.method === 'GET') {
      const { records } = await store.state(link.workspace_id);
      json(res, 200, {
        title: record.title,
        start: d.start,
        end: d.end,
        status: record.status,
        changeable,
        timezone: a?.timezone,
        slots: a && changeable ? availableSlots(a, records, Date.now(), { excludeId: record.id }) : [],
      });
      return;
    }
    if (req.method !== 'POST') throw fail(405, 'This action is not available.');
    if (!changeable) throw fail(409, 'This appointment has already started.');
    const input = await body(req);
    if (input.action === 'cancel') {
      await store.updateRecord(link.workspace_id, record.id, record.version, {
        status: 'Cancelled',
        data: JSON.stringify({ ...d, notes: [d.notes, 'Cancelled by guest.'].filter(Boolean).join('\n') }),
      });
      await store.deleteBookingToken(hash);
      json(res, 200, { cancelled: true });
      return;
    }
    if (input.action === 'reschedule') {
      if (!a) throw fail(409, 'Rescheduling is not available. Contact the organiser.');
      const { records } = await store.state(link.workspace_id);
      const start = String(input.start || '');
      if (!availableSlots(a, records, Date.now(), { excludeId: record.id }).includes(start))
        throw fail(409, 'That time is no longer available.');
      const end = new Date(Date.parse(start) + a.slotMinutes * 60000).toISOString();
      await store.updateRecord(link.workspace_id, record.id, record.version, {
        data: JSON.stringify({ ...d, start, end }),
      });
      json(res, 200, { start, end });
      return;
    }
    throw fail(400, 'Choose to reschedule or cancel.');
  }

  /** Routes that do not need a session. Returns true when handled. */
  async function publicRoute(req, res, url) {
    if (url.pathname === '/api/page') {
      const token = req.headers['x-workspace-page'];
      if (!hex(token)) throw fail(410, 'This page is not available.');
      rate('page:' + req.socket.remoteAddress, 300);
      const page = await store.pageByHash(sessionHash(token));
      if (!page) throw fail(410, 'This page is not available.');
      await publicPage(req, res, page);
      return true;
    }
    if (url.pathname === '/api/booking-manage') {
      await manageBooking(req, res, req.headers['x-booking-token']);
      return true;
    }
    if (url.pathname === '/api/invite' && req.method === 'GET') {
      const token = req.headers['x-workspace-invite'];
      const invite = hex(token) && (await store.getInvite(sessionHash(token)));
      if (!invite) throw fail(410, 'This invitation has expired or was revoked.');
      json(res, 200, {
        workspaceName: invite.workspaceName,
        role: invite.role,
        email: invite.email,
        expires: invite.expires,
      });
      return true;
    }
    return false;
  }

  /** Signed-in routes for team, security, account and public page management. */
  async function privateRoute(req, res, url, user, ws) {
    const path = url.pathname;
    const m = req.method;
    if (path === '/api/workspaces' && m === 'GET') {
      json(res, 200, await workspaces(user));
      return true;
    }
    if (path === '/api/workspaces/active' && m === 'POST') {
      const { id } = await body(req);
      const list = await workspaces(user);
      if (!list.some((w) => w.id === id)) throw fail(404, 'You are not a member of that workspace.');
      json(res, 200, { id }, { 'Set-Cookie': cookie('bw_workspace', id, 604800) });
      return true;
    }
    if (path === '/api/team' && m === 'GET') {
      const owner = ws.id === user.id ? user : null;
      json(res, 200, {
        role: ws.role,
        owner: owner ? { id: owner.id, name: owner.name, email: owner.email } : { id: ws.id, name: ws.name },
        members: (await store.members(ws.id)).map(({ user_id, email, name, role, joined }) => ({
          user_id,
          email,
          name,
          role,
          joined,
        })),
        invites:
          rank[ws.role] >= rank.admin
            ? (await store.invites(ws.id)).map(({ hash, email, role, expires }) => ({ hash, email, role, expires }))
            : [],
      });
      return true;
    }
    if (path === '/api/team/invites' && m === 'POST') {
      requireRole(ws, 'admin');
      rate('invite:' + ws.id, 30);
      const input = await body(req);
      const to = email(input.email);
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to) || to.length > 254) throw fail(400, 'Enter a valid email address.');
      if (!['admin', 'member'].includes(input.role)) throw fail(400, 'Choose admin or member.');
      if (input.role === 'admin') requireRole(ws, 'owner');
      const members = await store.members(ws.id);
      if (to === user.email && ws.id === user.id) throw fail(400, 'You already own this workspace.');
      if (members.some((x) => x.email === to)) throw fail(400, 'This person is already a member.');
      if (members.length >= 25) throw fail(400, 'This workspace has reached its 25-member limit.');
      const token = randomBytes(32).toString('hex');
      const expires = Date.now() + 7 * 86400000;
      await store.createInvite(ws.id, {
        hash: sessionHash(token),
        email: to,
        role: input.role,
        workspace_id: ws.id,
        workspaceName: ws.name,
        invitedBy: user.email,
        created: new Date().toISOString(),
        expires,
      });
      json(res, 201, { token, expires });
      return true;
    }
    const inviteMatch = /^\/api\/team\/invites\/([a-f0-9]{64})$/.exec(path);
    if (inviteMatch && m === 'DELETE') {
      requireRole(ws, 'admin');
      await store.revokeInvite(ws.id, inviteMatch[1]);
      json(res, 200, { revoked: true });
      return true;
    }
    if (path === '/api/invite/accept' && m === 'POST') {
      const token = req.headers['x-workspace-invite'];
      const invite = hex(token) && (await store.getInvite(sessionHash(token)));
      if (!invite) throw fail(410, 'This invitation has expired or was revoked.');
      if (invite.email !== user.email)
        throw fail(403, `This invitation was sent to ${invite.email}. Sign in with that email to accept it.`);
      if (invite.workspace_id === user.id) throw fail(400, 'You already own this workspace.');
      const member = await store.acceptInvite(sessionHash(token), {
        user_id: user.id,
        email: user.email,
        name: user.name,
        joined: new Date().toISOString(),
      });
      json(res, 200, { id: member.workspace_id, name: member.workspaceName, role: member.role }, {
        'Set-Cookie': cookie('bw_workspace', member.workspace_id, 604800),
      });
      return true;
    }
    const memberMatch = /^\/api\/team\/members\/([a-f0-9-]{36})$/.exec(path);
    if (memberMatch) {
      const target = await store.membership(ws.id, memberMatch[1]);
      if (!target) throw fail(404, 'This member is no longer in the workspace.');
      if (m === 'PATCH') {
        requireRole(ws, 'owner');
        const { role } = await body(req);
        if (!['admin', 'member'].includes(role)) throw fail(400, 'Choose admin or member.');
        await store.setMemberRole(ws.id, target.user_id, role);
        json(res, 200, { role });
        return true;
      }
      if (m === 'DELETE') {
        const leaving = target.user_id === user.id;
        if (!leaving) {
          requireRole(ws, 'admin');
          if (target.role === 'admin') requireRole(ws, 'owner');
        }
        await store.removeMember(ws.id, target.user_id);
        json(res, 200, { removed: true }, leaving ? { 'Set-Cookie': cookie('bw_workspace', '', 0) } : {});
        return true;
      }
    }
    if (path === '/api/security' && m === 'GET') {
      const profile = await store.userByEmail(user.email);
      json(res, 200, {
        totp: !!profile.security?.totp,
        recoveryCodesLeft: profile.security?.recoveryCodes?.length || 0,
      });
      return true;
    }
    if (path.startsWith('/api/security/totp/') && m === 'POST') {
      rate('totp:' + user.id, 20);
      const input = await body(req);
      const profile = await store.userByEmail(user.email);
      const security = profile.security || { version: 0 };
      const action = path.slice('/api/security/totp/'.length);
      if (action === 'setup') {
        if (security.totp) throw fail(409, 'Two-factor authentication is already on.');
        const secret = newSecret();
        await store.setSecurity(user.email, security.version || 0, { ...security, pendingSecret: secret });
        json(res, 200, { secret, uri: otpauthURL(secret, user.email) });
        return true;
      }
      if (action === 'enable') {
        if (security.totp) throw fail(409, 'Two-factor authentication is already on.');
        if (!security.pendingSecret) throw fail(400, 'Start the setup again.');
        const step = verifyTotp(security.pendingSecret, input.code);
        if (step === null) throw fail(400, 'That code did not match. Check the time on your phone and try again.');
        const { codes, hashes } = newRecoveryCodes();
        const { pendingSecret, ...rest } = security;
        await store.setSecurity(user.email, security.version || 0, {
          ...rest,
          totp: { secret: pendingSecret, lastStep: step, enabled: new Date().toISOString() },
          recoveryCodes: hashes,
        });
        json(res, 200, { enabled: true, recoveryCodes: codes });
        return true;
      }
      if (action === 'disable') {
        if (!security.totp) throw fail(409, 'Two-factor authentication is already off.');
        if (!verifyPassword(profile, input.password)) throw fail(400, 'The password is incorrect.');
        if (!(await secondFactor(profile, input.code))) throw fail(400, 'Enter a valid authenticator or recovery code.');
        const fresh = (await store.userByEmail(user.email)).security;
        const { totp, recoveryCodes, pendingSecret, ...rest } = fresh;
        await store.setSecurity(user.email, fresh.version, rest);
        json(res, 200, { enabled: false });
        return true;
      }
    }
    if (path === '/api/security/sessions/revoke' && m === 'POST') {
      await store.revokeSessions(user);
      json(res, 200, { revoked: true }, { 'Set-Cookie': clearSession });
      return true;
    }
    if (path === '/api/account/delete' && m === 'POST') {
      rate('delete:' + user.id, 5);
      const input = await body(req);
      const profile = await store.userByEmail(user.email);
      if (email(input.confirm) !== user.email) throw fail(400, 'Type your email address to confirm.');
      if (!verifyPassword(profile, input.password)) throw fail(400, 'The password is incorrect.');
      if (!(await secondFactor(profile, input.code))) throw fail(400, 'Enter a valid authenticator or recovery code.');
      await store.deleteAccount(user);
      json(res, 200, { deleted: true }, { 'Set-Cookie': clearSession });
      return true;
    }
    if (path === '/api/availability') {
      if (m === 'GET') {
        json(res, 200, await store.getSetting(ws.id, 'availability'));
        return true;
      }
      if (m === 'PUT') {
        requireRole(ws, 'admin');
        const value = clean(validateAvailability, await body(req));
        await store.putSetting(ws.id, 'availability', value);
        json(res, 200, value);
        return true;
      }
    }
    if (path === '/api/pages' && m === 'GET') {
      const pages = await store.pages(ws.id);
      json(res, 200, pages.map(({ kind, token, created }) => ({ kind, token, created })));
      return true;
    }
    if (path === '/api/pages' && m === 'POST') {
      requireRole(ws, 'admin');
      await billing.requirePro(ws.id);
      const { kind } = await body(req);
      if (!pageKinds.includes(kind)) throw fail(400, 'Choose a supported public page.');
      if (kind === 'booking' && !(await store.getSetting(ws.id, 'availability')))
        throw fail(400, 'Set your weekly availability before publishing a booking page.');
      const token = randomBytes(32).toString('hex');
      const page = { kind, token, hash: sessionHash(token), workspace_id: ws.id, brand: ws.name, created: new Date().toISOString() };
      await store.createPage(ws.id, page);
      json(res, 201, { kind, token, created: page.created });
      return true;
    }
    const pageMatch = /^\/api\/pages\/(\w+)$/.exec(path);
    if (pageMatch && m === 'DELETE') {
      requireRole(ws, 'admin');
      await store.deletePage(ws.id, pageMatch[1]);
      json(res, 200, { removed: true });
      return true;
    }
    return false;
  }

  return { publicRoute, privateRoute, workspaceFor, secondFactor, requireRole, createManageToken };
}
