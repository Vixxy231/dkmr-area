// Menyusun folder dari file lepas + menyalin ffmpeg.wasm ke public/ffmpeg
const fs = require('fs'), path = require('path');
const root = __dirname, pub = path.join(root, 'public'), fn = path.join(root, 'netlify', 'functions'), out = path.join(pub, 'ffmpeg');
fs.mkdirSync(out, { recursive: true }); fs.mkdirSync(fn, { recursive: true });
fs.copyFileSync(path.join(root, 'index.html'), path.join(pub, 'index.html'));
fs.copyFileSync(path.join(root, 'api.js'), path.join(fn, 'api.js'));
const m = n => path.join(root, 'node_modules', n);
const copy = (dir, re) => { for (const f of fs.readdirSync(dir)) if (re.test(f)) fs.copyFileSync(path.join(dir, f), path.join(out, f)); };
copy(m('@ffmpeg/ffmpeg/dist/umd'), /\.js$/);
copy(m('@ffmpeg/core/dist/umd'), /^ffmpeg-core\.(js|wasm)$/);
console.log('Build selesai:', fs.readdirSync(out).join(', '));
