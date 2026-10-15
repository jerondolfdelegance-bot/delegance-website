// Passkeys (WebAuthn): sign in with Face ID, a fingerprint, Windows Hello or a phone.
// No passwords travel; the device proves who you are with a private key that never leaves it.
// Verification follows the WebAuthn Level 2 "verifying a registration / assertion" steps.

export const b64u = {
  enc(buf) { let s = ''; for (const b of new Uint8Array(buf)) s += String.fromCharCode(b); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); },
  dec(str) { const s = String(str || '').replace(/-/g, '+').replace(/_/g, '/'); const bin = atob(s + '==='.slice((s.length + 3) % 4)); const out = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out; },
};

// Minimal CBOR decoder: enough for attestation objects and COSE keys (maps, arrays, ints, byte/text strings).
function cbor(bytes) {
  let i = 0;
  const len = info => {
    if (info < 24) return info;
    if (info === 24) return bytes[i++];
    if (info === 25) { const v = (bytes[i] << 8) | bytes[i + 1]; i += 2; return v; }
    if (info === 26) { const v = ((bytes[i] << 24) >>> 0) + (bytes[i + 1] << 16) + (bytes[i + 2] << 8) + bytes[i + 3]; i += 4; return v; }
    throw new Error('Unsupported CBOR length');
  };
  const item = () => {
    const b = bytes[i++], major = b >> 5, info = b & 31;
    if (major === 0) return len(info);
    if (major === 1) return -1 - len(info);
    if (major === 2) { const n = len(info); const v = bytes.slice(i, i + n); i += n; return v; }
    if (major === 3) { const n = len(info); const v = new TextDecoder().decode(bytes.slice(i, i + n)); i += n; return v; }
    if (major === 4) { const n = len(info), a = []; for (let k = 0; k < n; k++) a.push(item()); return a; }
    if (major === 5) { const n = len(info), m = new Map(); for (let k = 0; k < n; k++) { const key = item(); m.set(key, item()); } return m; }
    if (major === 7) { if (info === 20) return false; if (info === 21) return true; if (info === 22) return null; }
    throw new Error('Unsupported CBOR item');
  };
  const v = item();
  return { value: v, end: i };
}

const sha = async data => new Uint8Array(await crypto.subtle.digest('SHA-256', data));
const eq = (a, b) => a.length === b.length && a.every((x, k) => x === b[k]);

function parseAuthData(ad) {
  if (ad.length < 37) throw new Error('Passkey data is too short.');
  const out = { rpIdHash: ad.slice(0, 32), flags: ad[32], counter: ((ad[33] << 24) >>> 0) + (ad[34] << 16) + (ad[35] << 8) + ad[36] };
  out.up = !!(out.flags & 1); out.uv = !!(out.flags & 4);
  if (out.flags & 64) {
    const idLen = (ad[53] << 8) | ad[54];
    out.credId = ad.slice(55, 55 + idLen);
    out.coseKey = cbor(ad.slice(55 + idLen)).value;
  }
  return out;
}

function coseToJwk(m) {
  const kty = m.get(1), alg = m.get(3);
  if (kty === 2 && alg === -7 && m.get(-1) === 1) return { alg: -7, jwk: { kty: 'EC', crv: 'P-256', x: b64u.enc(m.get(-2)), y: b64u.enc(m.get(-3)), ext: true } };
  if (kty === 3 && alg === -257) return { alg: -257, jwk: { kty: 'RSA', n: b64u.enc(m.get(-1)), e: b64u.enc(m.get(-2)), alg: 'RS256', ext: true } };
  throw new Error('This passkey type is not supported. Try another device.');
}

function checkClient(clientDataJSON, type, origin) {
  const c = JSON.parse(new TextDecoder().decode(clientDataJSON));
  if (c.type !== type) throw new Error('Wrong passkey request type.');
  if (c.origin !== origin) throw new Error('This passkey request did not come from Delegance.');
  if (c.crossOrigin) throw new Error('Passkeys must be used on delegance.app itself.');
  return c.challenge;
}

// Registration: returns { credId, publicKey (JSON), alg, counter } after every check passes.
export async function verifyRegistration({ credential, rpId, origin, expectChallenge }) {
  const r = credential && credential.response || {};
  const clientData = b64u.dec(r.clientDataJSON);
  if (checkClient(clientData, 'webauthn.create', origin) !== expectChallenge) throw new Error('This passkey request expired. Please try again.');
  const att = cbor(b64u.dec(r.attestationObject)).value;
  const ad = parseAuthData(att.get('authData'));
  if (!eq(ad.rpIdHash, await sha(new TextEncoder().encode(rpId)))) throw new Error('This passkey is for a different website.');
  if (!ad.up || !ad.uv) throw new Error('Your device must confirm it is you (fingerprint, face or PIN).');
  if (!ad.credId || !ad.coseKey) throw new Error('The device did not send a passkey.');
  const key = coseToJwk(ad.coseKey);
  return { credId: b64u.enc(ad.credId), publicKey: JSON.stringify(key.jwk), alg: key.alg, counter: ad.counter };
}

// Sign-in: verifies the signature with the stored public key. Returns the new counter.
export async function verifyAssertion({ credential, rpId, origin, expectChallenge, publicKey, alg, storedCounter }) {
  const r = credential && credential.response || {};
  const clientData = b64u.dec(r.clientDataJSON), authData = b64u.dec(r.authenticatorData), sig = b64u.dec(r.signature);
  if (checkClient(clientData, 'webauthn.get', origin) !== expectChallenge) throw new Error('This sign-in expired. Please try again.');
  const ad = parseAuthData(authData);
  if (!eq(ad.rpIdHash, await sha(new TextEncoder().encode(rpId)))) throw new Error('This passkey is for a different website.');
  if (!ad.up || !ad.uv) throw new Error('Your device must confirm it is you (fingerprint, face or PIN).');
  const signed = new Uint8Array(authData.length + 32); signed.set(authData); signed.set(await sha(clientData), authData.length);
  const jwk = JSON.parse(publicKey);
  let ok;
  if (alg === -7) {
    const k = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, k, derToRaw(sig), signed);
  } else if (alg === -257) {
    const k = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', k, sig, signed);
  }
  if (!ok) throw new Error('That passkey could not be verified.');
  // A counter that goes backwards means a cloned key. Synced passkeys always send 0, which is fine.
  if (storedCounter > 0 && ad.counter <= storedCounter) throw new Error('This passkey looks copied. Remove it and add it again.');
  return ad.counter;
}

// ECDSA signatures arrive DER-encoded; WebCrypto wants raw r||s (32 bytes each).
function derToRaw(der) {
  let i = 2; if (der[1] & 0x80) i += der[1] & 0x7f;
  const read = () => { i++; const n = der[i++]; let v = der.slice(i, i + n); i += n; while (v.length > 32 && v[0] === 0) v = v.slice(1); const o = new Uint8Array(32); o.set(v, 32 - v.length); return o; };
  const r = read(), s = read(), out = new Uint8Array(64); out.set(r); out.set(s, 32); return out;
}
