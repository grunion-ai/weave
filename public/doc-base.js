(function (root) {
  function docBase(text) {
    const bytes = new TextEncoder().encode(text);
    const primes = [];
    for (let n = 2; primes.length < 64; n++) if (primes.every((p) => n % p)) primes.push(n);
    const frac = (x) => (x - Math.floor(x)) * 4294967296 | 0;
    const k = primes.map((p) => frac(Math.cbrt(p)));
    let state = primes.slice(0, 8).map((p) => frac(Math.sqrt(p)));
    const len = bytes.length;
    const words = new Int32Array((((len + 8) >> 6) + 1) * 16);
    for (let i = 0; i < len; i++) words[i >> 2] |= bytes[i] << (24 - (i & 3) * 8);
    words[len >> 2] |= 0x80 << (24 - (len & 3) * 8);
    words[words.length - 2] = Math.floor(len / 536870912);
    words[words.length - 1] = len * 8;
    const rot = (x, r) => (x >>> r) | (x << (32 - r));
    const w = new Int32Array(64);
    for (let j = 0; j < words.length; j += 16) {
      let [a, b, c, d, e, f, g, h] = state;
      for (let i = 0; i < 64; i++) {
        if (i < 16) w[i] = words[j + i];
        else w[i] = (rot(w[i - 15], 7) ^ rot(w[i - 15], 18) ^ (w[i - 15] >>> 3)) + w[i - 7] + (rot(w[i - 2], 17) ^ rot(w[i - 2], 19) ^ (w[i - 2] >>> 10)) + w[i - 16];
        const t1 = h + (rot(e, 6) ^ rot(e, 11) ^ rot(e, 25)) + ((e & f) ^ (~e & g)) + k[i] + w[i] | 0;
        const t2 = (rot(a, 2) ^ rot(a, 13) ^ rot(a, 22)) + ((a & b) ^ (a & c) ^ (b & c)) | 0;
        h = g; g = f; f = e; e = d + t1 | 0; d = c; c = b; b = a; a = t1 + t2 | 0;
      }
      state = [a, b, c, d, e, f, g, h].map((v, i) => v + state[i] | 0);
    }
    return state.map((v) => (v >>> 0).toString(16).padStart(8, '0')).join('');
  }
  root.weaveDocBase = docBase;
})(globalThis);
