const TZ = 'Asia/Tehran';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) return handleApi(request, env, url);
    return env.ASSETS.fetch(request);
  },
  async scheduled(event, env, ctx) {
    ctx.waitUntil(sendDueReminders(env));
  }
};

async function handleApi(request, env, url) {
  const cors = {
    'Access-Control-Allow-Origin': url.origin,
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin'
  };
  const json = (data, status=200) => new Response(JSON.stringify(data), {status, headers:{'Content-Type':'application/json; charset=utf-8', ...cors}});
  if (request.method === 'OPTIONS') return new Response(null, {headers:cors});

  if (url.pathname === '/api/config' && request.method === 'GET') {
    return json({timezone:TZ, vapidPublicKey:env.VAPID_PUBLIC_KEY || ''});
  }
  if (url.pathname === '/api/reminders' && request.method === 'GET') {
    const {results=[]} = await env.DB.prepare('SELECT id,title,time,active FROM reminders ORDER BY time').all();
    return json(results);
  }
  if (url.pathname === '/api/reminders' && request.method === 'POST') {
    const body = await request.json();
    const title = String(body.title || '').trim();
    const time = String(body.time || '');
    if (!title || title.length > 100 || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return json({error:'عنوان یا ساعت معتبر نیست.'},400);
    const id = crypto.randomUUID();
    await env.DB.prepare('INSERT INTO reminders(id,title,time,active) VALUES(?,?,?,1)').bind(id,title,time).run();
    return json({id,title,time,active:1},201);
  }
  const match = url.pathname.match(/^\/api\/reminders\/([\w-]+)$/);
  if (match && request.method === 'PUT') {
    const body = await request.json();
    const title = String(body.title || '').trim();
    const time = String(body.time || '');
    const active = body.active ? 1 : 0;
    if (!title || title.length > 100 || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return json({error:'عنوان یا ساعت معتبر نیست.'},400);
    await env.DB.prepare('UPDATE reminders SET title=?,time=?,active=? WHERE id=?').bind(title,time,active,match[1]).run();
    return json({ok:true});
  }
  if (match && request.method === 'DELETE') {
    await env.DB.prepare('DELETE FROM reminders WHERE id=?').bind(match[1]).run();
    return json({ok:true});
  }
  if (url.pathname === '/api/subscribe' && request.method === 'POST') {
    const sub = await request.json();
    if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) return json({error:'اطلاعات اشتراک اعلان ناقص است.'},400);
    await env.DB.prepare('INSERT OR REPLACE INTO subscriptions(endpoint,p256dh,auth) VALUES(?,?,?)')
      .bind(sub.endpoint,sub.keys.p256dh,sub.keys.auth).run();
    return json({ok:true});
  }
  if (url.pathname === '/api/test' && request.method === 'POST') {
    const {results=[]} = await env.DB.prepare('SELECT endpoint,p256dh,auth FROM subscriptions').all();
    if (!results.length) return json({error:'ابتدا اعلان‌ها را روی گوشی فعال کن.'},400);
    const payload = JSON.stringify({title:'یادآور مازیار', body:'اعلان آزمایشی با موفقیت ارسال شد.', url:'/'});
    const outcomes = await Promise.all(results.map(s => sendPush(s,payload,env).then(async r => {
      if (r.status===404 || r.status===410) await env.DB.prepare('DELETE FROM subscriptions WHERE endpoint=?').bind(s.endpoint).run();
      return r.ok;
    }).catch(()=>false)));
    return json({sent:outcomes.filter(Boolean).length,total:outcomes.length});
  }
  return json({error:'مسیر پیدا نشد.'},404);
}

async function sendDueReminders(env) {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-CA', {timeZone:TZ, year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', hourCycle:'h23'}).formatToParts(now);
  const get = t => parts.find(p=>p.type===t)?.value;
  const today = `${get('year')}-${get('month')}-${get('day')}`;
  const hm = `${get('hour')}:${get('minute')}`;
  const {results:due=[]} = await env.DB.prepare('SELECT id,title FROM reminders WHERE active=1 AND time=? AND (last_sent_date IS NULL OR last_sent_date<>?)').bind(hm,today).all();
  if (!due.length) return;
  const {results:subs=[]} = await env.DB.prepare('SELECT endpoint,p256dh,auth FROM subscriptions').all();
  for (const item of due) {
    await env.DB.prepare('UPDATE reminders SET last_sent_date=? WHERE id=?').bind(today,item.id).run();
    const payload = JSON.stringify({title:'یادآوری', body:item.title, url:'/'});
    for (const sub of subs) {
      try {
        const response = await sendPush(sub,payload,env);
        if (response.status===404 || response.status===410) await env.DB.prepare('DELETE FROM subscriptions WHERE endpoint=?').bind(sub.endpoint).run();
      } catch (e) { /* A failed device must not stop other reminders. */ }
    }
  }
}

async function sendPush(sub, payload, env) {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) throw new Error('VAPID keys are missing');
  const endpoint = new URL(sub.endpoint);
  const token = await makeVapidToken(endpoint.origin, env);
  const body = await encryptPayload(payload, sub.p256dh, sub.auth);
  return fetch(sub.endpoint, {
    method:'POST',
    headers:{
      'Authorization':`vapid t=${token}, k=${env.VAPID_PUBLIC_KEY}`,
      'Content-Encoding':'aes128gcm',
      'Content-Type':'application/octet-stream',
      'TTL':'86400',
      'Urgency':'high'
    },
    body
  });
}

async function makeVapidToken(audience, env) {
  const header = b64url(new TextEncoder().encode(JSON.stringify({typ:'JWT',alg:'ES256'})));
  const now = Math.floor(Date.now()/1000);
  const claims = b64url(new TextEncoder().encode(JSON.stringify({aud:audience,exp:now+12*60*60,sub:env.VAPID_SUBJECT || 'mailto:admin@example.com'})));
  const input = `${header}.${claims}`;
  const keyBytes = unb64url(env.VAPID_PRIVATE_KEY);
  const key = await crypto.subtle.importKey('pkcs8', keyBytes, {name:'ECDSA',namedCurve:'P-256'}, false, ['sign']);
  const sig = await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},key,new TextEncoder().encode(input));
  return `${input}.${b64url(new Uint8Array(sig))}`;
}

async function encryptPayload(message, userPublicB64, authB64) {
  const userPublic = unb64url(userPublicB64);
  const auth = unb64url(authB64);
  const receiverKey = await crypto.subtle.importKey('raw',userPublic,{name:'ECDH',namedCurve:'P-256'},false,[]);
  const senderPair = await crypto.subtle.generateKey({name:'ECDH',namedCurve:'P-256'},true,['deriveBits']);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({name:'ECDH',public:receiverKey},senderPair.privateKey,256));
  const senderPublic = new Uint8Array(await crypto.subtle.exportKey('raw',senderPair.publicKey));
  const prkKey = await hkdfExtract(auth,shared);
  const info = concat(new TextEncoder().encode('WebPush: info\0'),userPublic,senderPublic);
  const ikm = await hkdfExpand(prkKey,info,32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const prk = await hkdfExtract(salt,ikm);
  const cek = await hkdfExpand(prk,new TextEncoder().encode('Content-Encoding: aes128gcm\0'),16);
  const nonce = await hkdfExpand(prk,new TextEncoder().encode('Content-Encoding: nonce\0'),12);
  const key = await crypto.subtle.importKey('raw',cek,{name:'AES-GCM'},false,['encrypt']);
  const plain = concat(new TextEncoder().encode(message),new Uint8Array([2]));
  const cipher = new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv:nonce},key,plain));
  const header = concat(salt,uint32(4096),new Uint8Array([senderPublic.length]),senderPublic);
  return concat(header,cipher);
}

async function hkdfExtract(salt, ikm) {
  const key = await crypto.subtle.importKey('raw',salt,{name:'HMAC',hash:'SHA-256'},false,['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC',key,ikm));
}
async function hkdfExpand(prk, info, length) {
  const key = await crypto.subtle.importKey('raw',prk,{name:'HMAC',hash:'SHA-256'},false,['sign']);
  let output = new Uint8Array(0), previous = new Uint8Array(0), counter = 1;
  while (output.length < length) {
    previous = new Uint8Array(await crypto.subtle.sign('HMAC',key,concat(previous,info,new Uint8Array([counter++]))));
    output = concat(output,previous);
  }
  return output.slice(0,length);
}
function concat(...arrays) { const out = new Uint8Array(arrays.reduce((n,a)=>n+a.length,0)); let p=0; for(const a of arrays){out.set(a,p);p+=a.length;} return out; }
function uint32(n) { return new Uint8Array([(n>>>24)&255,(n>>>16)&255,(n>>>8)&255,n&255]); }
function b64url(bytes) { let s=''; for(const b of bytes)s+=String.fromCharCode(b); return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,''); }
function unb64url(s) { const b=atob(s.replace(/-/g,'+').replace(/_/g,'/')); return Uint8Array.from(b,c=>c.charCodeAt(0)); }
