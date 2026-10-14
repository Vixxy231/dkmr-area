// DKMR AREA - satu Netlify Function untuk semua endpoint
const crypto = require('crypto');
const { connectLambda, getStore } = require('@netlify/blobs');
const E = process.env, SECRET = E.SESSION_SECRET || 'ganti-ini', LIMIT = +E.FREE_DAILY_LIMIT || 2;
const OWNERS = (E.OWNER_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
const sign = v => crypto.createHmac('sha256', SECRET).update(v).digest('hex');
const cookies = h => Object.fromEntries((h.cookie || '').split(';').map(c => c.trim().split(/=(.*)/s).slice(0, 2)).filter(c => c[0]));
const ck = (n, v, age) => `${n}=${v}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${age}`;
const J = (code, data, extra = []) => ({ statusCode: code, headers: { 'Content-Type': 'application/json' }, multiValueHeaders: extra.length ? { 'Set-Cookie': extra } : undefined, body: JSON.stringify(data) });
const R = (loc, extra = []) => ({ statusCode: 302, headers: { Location: loc }, multiValueHeaders: extra.length ? { 'Set-Cookie': extra } : undefined, body: '' });
const form = o => new URLSearchParams(o);
let store;
const getU = async id => (await store.get('u:' + id, { type: 'json' })) || null;
const putU = u => store.setJSON('u:' + u.id, u);
const publicU = u => ({ id: u.id, name: u.name, avatar: u.avatar, roblox: u.rb ? { id: u.rb.id, name: u.rb.name } : null, owner: OWNERS.includes(u.id), limit: OWNERS.includes(u.id) ? null : LIMIT, used: (u.uses || []).filter(t => t > Date.now() - 864e5).length, robloxEnabled: !!E.ROBLOX_CLIENT_ID, tracks: u.tracks || [], albums: u.albums || [] });

async function rbToken(p) { return (await fetch('https://apis.roblox.com/oauth/v1/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form({ client_id: E.ROBLOX_CLIENT_ID, client_secret: E.ROBLOX_CLIENT_SECRET, ...p }) })).json(); }
async function rbAccess(u) {
  if (!u.rb) throw new Error('Akun Roblox belum terhubung');
  if (u.rb.exp > Date.now()) return u.rb.access;
  const t = await rbToken({ grant_type: 'refresh_token', refresh_token: u.rb.refresh });
  if (!t.access_token) throw new Error('Sesi Roblox habis, hubungkan ulang akun Roblox');
  u.rb = { ...u.rb, access: t.access_token, refresh: t.refresh_token || u.rb.refresh, exp: Date.now() + (t.expires_in - 60) * 1000 }; await putU(u); return u.rb.access;
}

exports.handler = async (event) => {
  connectLambda(event); store = getStore('dkmr');
  const BASE = (E.BASE_URL || E.URL || '').replace(/\/$/, ''), p = event.path.replace(/^\/\.netlify\/functions\/api/, ''), m = event.httpMethod, c = cookies(event.headers);
  let body = {}; if (event.body && !p.startsWith('/api/upload')) { try { body = JSON.parse(event.body); } catch {} }
  try {
    // ----- Discord (akun, scope identify)
    if (p === '/auth/discord') { const s = crypto.randomBytes(12).toString('hex'); return R('https://discord.com/oauth2/authorize?' + form({ client_id: E.DISCORD_CLIENT_ID, redirect_uri: BASE + '/auth/discord/callback', response_type: 'code', scope: 'identify', state: s, prompt: 'none' }), [ck('ds', s, 600)]); }
    if (p === '/auth/discord/callback') {
      const q = event.queryStringParameters || {};
      if (!q.code || q.state !== c.ds) return R('/?err=state');
      const t = await (await fetch('https://discord.com/api/oauth2/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form({ client_id: E.DISCORD_CLIENT_ID, client_secret: E.DISCORD_CLIENT_SECRET, grant_type: 'authorization_code', code: q.code, redirect_uri: BASE + '/auth/discord/callback' }) })).json();
      if (!t.access_token) return R('/?err=token');
      const d = await (await fetch('https://discord.com/api/users/@me', { headers: { Authorization: 'Bearer ' + t.access_token } })).json();
      const u = (await getU(d.id)) || { id: d.id, uses: [], tracks: [], albums: [] };
      u.name = d.global_name || d.username; u.avatar = d.avatar ? `https://cdn.discordapp.com/avatars/${d.id}/${d.avatar}.png?size=128` : ''; await putU(u);
      const b = Buffer.from(JSON.stringify({ uid: d.id, exp: Date.now() + 30 * 864e5 })).toString('base64url');
      return R('/', [ck('sid', b + '.' + sign(b), 2592000)]);
    }
    if (p === '/auth/logout') return J(200, { ok: true }, [ck('sid', '', 0)]);

    // ----- login wajib untuk sisanya
    let u = null; const [b, s] = (c.sid || '').split('.');
    try { if (b && s && s.length === sign(b).length && crypto.timingSafeEqual(Buffer.from(s), Buffer.from(sign(b)))) { const pl = JSON.parse(Buffer.from(b, 'base64url')); if (pl.exp > Date.now()) u = await getU(pl.uid); } } catch {}
    if (!u) return p.startsWith('/auth/') ? R('/') : J(401, { error: 'Belum login' });

    // ----- Roblox OAuth
    if (p === '/auth/roblox') { const st = crypto.randomBytes(12).toString('hex'); return R('https://apis.roblox.com/oauth/v1/authorize?' + form({ client_id: E.ROBLOX_CLIENT_ID, redirect_uri: BASE + '/auth/roblox/callback', scope: 'openid profile asset:read asset:write', response_type: 'code', state: st }), [ck('rs', st, 600)]); }
    if (p === '/auth/roblox/callback') {
      const q = event.queryStringParameters || {}; if (q.state !== c.rs) return R('/?err=state');
      const t = await rbToken({ grant_type: 'authorization_code', code: q.code, redirect_uri: BASE + '/auth/roblox/callback' });
      if (!t.access_token) return R('/?err=roblox');
      const i = await (await fetch('https://apis.roblox.com/oauth/v1/userinfo', { headers: { Authorization: 'Bearer ' + t.access_token } })).json();
      u.rb = { id: i.sub, name: i.preferred_username || i.name, access: t.access_token, refresh: t.refresh_token, exp: Date.now() + (t.expires_in - 60) * 1000 }; await putU(u); return R('/?roblox=ok');
    }
    if (p === '/api/roblox/disconnect') { delete u.rb; await putU(u); return J(200, { ok: true }); }

    // ----- Data
    if (p === '/api/me') return J(200, publicU(u));
    if (p === '/api/reserve' && m === 'POST') {
      u.uses = (u.uses || []).filter(t => t > Date.now() - 864e5);
      if (!OWNERS.includes(u.id) && u.uses.length >= LIMIT) return J(429, { error: `Batas harian ${LIMIT}x sudah habis` });
      u.uses.push(Date.now()); await putU(u); return J(200, { ok: true });
    }
    if (p === '/api/track' && m === 'POST') {
      const t = { id: crypto.randomUUID(), title: String(body.title || 'Tanpa judul').slice(0, 120), speed: +body.speed || 1, gain: +body.gain || 0, created: Date.now(), asset_id: null };
      u.tracks = [t, ...(u.tracks || [])].slice(0, 200); await putU(u); return J(200, t);
    }
    let mt;
    if ((mt = p.match(/^\/api\/track\/([\w-]+)$/)) && m === 'DELETE') { u.tracks = (u.tracks || []).filter(t => t.id !== mt[1]); (u.albums || []).forEach(a => a.items = a.items.filter(i => i !== mt[1])); await putU(u); return J(200, { ok: true }); }
    if (p === '/api/albums' && m === 'POST') { const n = String(body.name || '').trim().slice(0, 40); if (!n) return J(400, { error: 'Nama album kosong' }); (u.albums = u.albums || []).push({ id: crypto.randomUUID(), name: n, items: [] }); await putU(u); return J(200, { ok: true }); }
    if ((mt = p.match(/^\/api\/albums\/([\w-]+)$/)) && m === 'DELETE') { u.albums = (u.albums || []).filter(a => a.id !== mt[1]); await putU(u); return J(200, { ok: true }); }
    if ((mt = p.match(/^\/api\/albums\/([\w-]+)\/items(?:\/([\w-]+))?$/))) {
      const a = (u.albums || []).find(x => x.id === mt[1]); if (!a) return J(404, { error: 'Album tidak ada' });
      if (m === 'POST') { if (!a.items.includes(body.track) && (u.tracks || []).some(t => t.id === body.track)) a.items.push(body.track); } else if (m === 'DELETE') a.items = a.items.filter(i => i !== mt[2]);
      await putU(u); return J(200, { ok: true });
    }

    // ----- Upload ke Roblox (maks ~4MB karena batas body Netlify 6MB)
    if (p === '/api/upload' && m === 'POST') {
      const tr = (u.tracks || []).find(t => t.id === event.headers['x-track']); if (!tr) return J(404, { error: 'Track tidak ditemukan' });
      const buf = Buffer.from(event.body || '', event.isBase64Encoded ? 'base64' : 'utf8'); if (!buf.length) return J(400, { error: 'File kosong' });
      const tok = await rbAccess(u), fd = new FormData();
      fd.append('request', JSON.stringify({ assetType: 'Audio', displayName: tr.title.slice(0, 50), description: 'DKMR AREA', creationContext: { creator: { userId: u.rb.id } } }));
      fd.append('fileContent', new Blob([buf], { type: 'audio/ogg' }), tr.id + '.ogg');
      const r = await (await fetch('https://apis.roblox.com/assets/v1/assets', { method: 'POST', headers: { Authorization: 'Bearer ' + tok }, body: fd })).json();
      if (!r.path) return J(400, { error: r.message || 'Upload Roblox ditolak' }); return J(200, { op: r.path });
    }
    if (p === '/api/op' && m === 'GET') {
      const q = event.queryStringParameters || {}, tr = (u.tracks || []).find(t => t.id === q.track); if (!tr || !/^operations\/[\w-]+$/.test(q.op || '')) return J(400, { error: 'Permintaan tidak valid' });
      const o = await (await fetch('https://apis.roblox.com/assets/v1/' + q.op, { headers: { Authorization: 'Bearer ' + await rbAccess(u) } })).json();
      if (!o.done) return J(200, { done: false });
      if (o.response && o.response.assetId) { tr.asset_id = String(o.response.assetId); await putU(u); return J(200, { done: true, asset_id: tr.asset_id }); }
      return J(200, { done: true, error: (o.error && o.error.message) || 'Moderasi Roblox menolak audio' });
    }
    return J(404, { error: 'Tidak ditemukan' });
  } catch (e) { return J(500, { error: e.message || 'Server error' }); }
};
