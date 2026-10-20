(function (root) {
  const MAX_SIDE = 320;
  const MAX_BYTES = 256 * 1024;
  const TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
  const takes = (mime) => TYPES.has(String(mime ?? '').split(';')[0].trim().toLowerCase());
  const box = (width, height, max = MAX_SIDE) => {
    const long = Math.max(width, height);
    if (!(long > max)) return null;
    return { width: Math.max(1, Math.round((width * max) / long)), height: Math.max(1, Math.round((height * max) / long)) };
  };
  const src = (file, base = '') => `${base}/api/files/${file.id}${file.preview ? '?preview' : ''}`;
  const encode = (canvas, type) => new Promise((res) => canvas.toBlob((b) => res(b?.type === type ? b : null), type, 0.8));

  async function make(file, doc = root.document) {
    if (!takes(file?.type) || typeof root.createImageBitmap !== 'function') return null;
    let bitmap;
    try {
      bitmap = await root.createImageBitmap(file);
      const size = box(bitmap.width, bitmap.height);
      if (!size) return null;
      const canvas = doc.createElement('canvas');
      canvas.width = size.width;
      canvas.height = size.height;
      const g = canvas.getContext('2d');
      g.drawImage(bitmap, 0, 0, size.width, size.height);
      let blob = await encode(canvas, 'image/webp');
      if (!blob) {
        g.globalCompositeOperation = 'destination-over';
        g.fillStyle = '#ffffff';
        g.fillRect(0, 0, size.width, size.height);
        blob = await encode(canvas, 'image/jpeg');
      }
      return blob && blob.size <= MAX_BYTES && blob.size < file.size ? blob : null;
    } catch {
      return null;
    } finally {
      bitmap?.close?.();
    }
  }

  root.WeavePreview = { MAX_SIDE, MAX_BYTES, takes, box, src, make };
})(globalThis);
