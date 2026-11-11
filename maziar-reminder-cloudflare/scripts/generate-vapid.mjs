import { webcrypto } from 'node:crypto';
const pair = await webcrypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);
const priv = new Uint8Array(await webcrypto.subtle.exportKey('pkcs8',pair.privateKey));
const pub = new Uint8Array(await webcrypto.subtle.exportKey('raw',pair.publicKey));
const b64 = b => Buffer.from(b).toString('base64url');
console.log('\nVAPID_PUBLIC_KEY='+b64(pub));
console.log('VAPID_PRIVATE_KEY='+b64(priv));
console.log('VAPID_SUBJECT=mailto:your-email@example.com\n');
