import { neon } from '@neondatabase/serverless';
import { put, del } from '@vercel/blob';
import bcrypt from 'bcryptjs';
import { SignJWT, jwtVerify } from 'jose';
import ExcelJS from 'exceljs';

const KOND = ['layak', 'tidak layak'];
const STATUS = ['Menunggu', 'Diproses', 'Selesai', 'Ditolak'];
const KAT = ['Kelas 7', 'Kelas 8', 'Kelas 9', 'Fasilitas', 'Kantor'];

let _sql;
const q = (text, params = []) => (_sql ??= neon(process.env.DATABASE_URL || process.env.POSTGRES_URL)).query(text, params);
const key = () => new TextEncoder().encode(process.env.JWT_SECRET || '');
const fail = (s, m) => { throw Object.assign(new Error(m), { s }); };

async function userOf(req) {
  const m = /(?:^|;\s*)sid=([^;]+)/.exec(req.headers.cookie || '');
  if (!m) return null;
  try { return (await jwtVerify(m[1], key())).payload; } catch { return null; }
}

function items(sp) {
  const w = ['TRUE'], p = [];
  if (sp.get('q')) { p.push('%' + sp.get('q') + '%'); w.push(`i.nama_barang ILIKE $${p.length}`); }
  if (sp.get('r')) { p.push(+sp.get('r')); w.push(`i.ruangan_id = $${p.length}`); }
  if (KOND.includes(sp.get('k'))) { p.push(sp.get('k')); w.push(`i.kondisi = $${p.length}`); }
  return q(`SELECT i.*, r.nama_ruangan FROM inventaris i JOIN ruangan r ON r.id = i.ruangan_id WHERE ${w.join(' AND ')} ORDER BY r.id, i.nama_barang`, p);
}

export default async function handler(req, res) {
  const url = new URL(req.url, 'http://x'), sp = url.searchParams;
  const [r, id] = url.pathname.replace(/^\/api\/?/, '').split('/').filter(Boolean);
  const M = req.method, send = (c, d) => res.status(c).json(d), ok = () => send(200, { ok: 1 });
  try {
    if (M !== 'GET' && !(req.headers['content-type'] || '').includes('application/json')) fail(400, 'Permintaan tidak valid.');
    const b = req.body && typeof req.body === 'object' ? req.body : {};

    if (r === 'login' && M === 'POST') {
      if (!process.env.JWT_SECRET) fail(500, 'JWT_SECRET belum diatur di Vercel.');
      const [x] = await q('SELECT * FROM users WHERE username = $1', [String(b.username || '').trim()]);
      if (!x || !(await bcrypt.compare(String(b.password || ''), x.password))) fail(401, 'Username atau password salah.');
      const t = await new SignJWT({ id: x.id, nama: x.nama, role: x.role }).setProtectedHeader({ alg: 'HS256' }).setExpirationTime('8h').sign(key());
      res.setHeader('Set-Cookie', `sid=${t}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=28800`);
      return send(200, { id: x.id, nama: x.nama, role: x.role });
    }
    if (r === 'logout') { res.setHeader('Set-Cookie', 'sid=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0'); return ok(); }

    const u = await userOf(req);
    if (!u) fail(401, 'Silakan login.');
    const admin = () => u.role === 'admin' || fail(403, 'Khusus admin.');
    if (r === 'me') return send(200, { id: u.id, nama: u.nama, role: u.role });

    if (r === 'stats') {
      admin();
      const k = await q('SELECT kondisi, COALESCE(SUM(jumlah),0)::int AS j FROM inventaris GROUP BY kondisi');
      const per = await q("SELECT r.nama_ruangan AS n, COALESCE(SUM(CASE WHEN i.kondisi='tidak layak' THEN i.jumlah END),0)::int AS j FROM ruangan r LEFT JOIN inventaris i ON i.ruangan_id = r.id GROUP BY r.id ORDER BY r.id");
      const [c] = await q("SELECT (SELECT COUNT(*) FROM ruangan)::int AS ruangan, (SELECT COUNT(*) FROM laporan_kerusakan WHERE status='Menunggu')::int AS menunggu");
      return send(200, { kondisi: Object.fromEntries(k.map(x => [x.kondisi, x.j])), per, ...c });
    }

    if (r === 'ruangan') {
      if (M === 'GET') return send(200, await q("SELECT r.*, COUNT(i.id)::int AS jenis, (COUNT(i.id) FILTER (WHERE i.kondisi='tidak layak'))::int AS rusak FROM ruangan r LEFT JOIN inventaris i ON i.ruangan_id = r.id GROUP BY r.id ORDER BY r.id"));
      admin();
      if (M === 'POST') {
        const n = String(b.nama || '').trim();
        if (!n || !KAT.includes(b.kategori)) fail(400, 'Isi nama ruangan dan pilih kategori.');
        try { await q('INSERT INTO ruangan (nama_ruangan, kategori) VALUES ($1,$2)', [n, b.kategori]); } catch { fail(409, 'Nama ruangan sudah ada.'); }
        return ok();
      }
      if (M === 'DELETE') {
        const f = await q('SELECT l.foto FROM laporan_kerusakan l JOIN inventaris i ON i.id = l.inventaris_id WHERE i.ruangan_id = $1 AND l.foto IS NOT NULL', [+id]);
        await q('DELETE FROM ruangan WHERE id = $1', [+id]);
        if (f.length) await del(f.map(x => x.foto)).catch(() => {});
        return ok();
      }
    }

    if (r === 'inventaris') {
      if (M === 'GET') return send(200, await items(sp));
      admin();
      if (M === 'DELETE') { await q('DELETE FROM inventaris WHERE id = $1', [+id]); return ok(); }
      const v = [+b.ruangan_id, String(b.nama || '').trim(), Math.max(1, +b.jumlah || 1), KOND.includes(b.kondisi) ? b.kondisi : 'layak', String(b.keterangan || '').trim()];
      if (!v[0] || !v[1]) fail(400, 'Ruangan dan nama barang wajib diisi.');
      if (M === 'POST') await q('INSERT INTO inventaris (ruangan_id, nama_barang, jumlah, kondisi, keterangan) VALUES ($1,$2,$3,$4,$5)', v);
      else if (M === 'PUT') await q('UPDATE inventaris SET ruangan_id=$1, nama_barang=$2, jumlah=$3, kondisi=$4, keterangan=$5, updated_at=now() WHERE id=$6', [...v, +id]);
      return ok();
    }

    if (r === 'export') {
      admin();
      const rows = await items(sp), wb = new ExcelJS.Workbook(), ws = wb.addWorksheet('Inventaris');
      ws.columns = [['Ruangan', 28], ['Barang', 28], ['Jumlah', 10], ['Kondisi', 14], ['Keterangan', 32]].map(([header, width], i) => ({ header, width, key: 'c' + i }));
      rows.forEach(x => ws.addRow({ c0: x.nama_ruangan, c1: x.nama_barang, c2: x.jumlah, c3: x.kondisi, c4: x.keterangan }));
      Object.assign(ws.getRow(1), { font: { bold: true, color: { argb: 'FFFFFFFF' } }, fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2563EB' } } });
      ws.views = [{ state: 'frozen', ySplit: 1 }]; ws.autoFilter = 'A1:E1';
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', 'attachment; filename="inventaris.xlsx"');
      return res.status(200).send(Buffer.from(await wb.xlsx.writeBuffer()));
    }

    if (r === 'laporan') {
      if (M === 'GET') {
        const a = u.role === 'admin';
        return send(200, await q(`SELECT l.*, u.nama AS pelapor, i.nama_barang, rr.nama_ruangan FROM laporan_kerusakan l JOIN users u ON u.id = l.user_id JOIN inventaris i ON i.id = l.inventaris_id JOIN ruangan rr ON rr.id = i.ruangan_id ${a ? '' : 'WHERE l.user_id = $1'} ORDER BY l.id DESC`, a ? [] : [u.id]));
      }
      if (M === 'POST') {
        if (u.role !== 'guru') fail(403, 'Khusus guru.');
        const des = String(b.deskripsi || '').trim(), [it] = await q('SELECT id FROM inventaris WHERE id = $1', [+b.inventaris_id]);
        if (!it || !des) fail(400, 'Pilih barang dan isi deskripsi kerusakan.');
        let foto = null;
        if (b.foto) {
          const m = /^data:image\/(jpeg|png|webp);base64,(.+)$/.exec(b.foto);
          if (!m) fail(400, 'Format foto tidak valid.');
          const buf = Buffer.from(m[2], 'base64');
          if (buf.length > 3e6) fail(400, 'Foto maksimal 3 MB.');
          foto = (await put(`laporan/foto.${m[1] === 'jpeg' ? 'jpg' : m[1]}`, buf, { access: 'public', contentType: 'image/' + m[1], addRandomSuffix: true })).url;
        }
        await q('INSERT INTO laporan_kerusakan (user_id, inventaris_id, deskripsi, foto) VALUES ($1,$2,$3,$4)', [u.id, +b.inventaris_id, des, foto]);
        return ok();
      }
      admin();
      if (M === 'PUT') {
        await q('UPDATE laporan_kerusakan SET status=$1, catatan_admin=$2 WHERE id=$3', [STATUS.includes(b.status) ? b.status : 'Menunggu', String(b.catatan || '').trim(), +id]);
        return ok();
      }
    }

    if (r === 'guru') {
      admin();
      if (M === 'GET') return send(200, await q("SELECT id, nama, username FROM users WHERE role='guru' ORDER BY nama"));
      if (M === 'DELETE') { await q("DELETE FROM users WHERE id = $1 AND role='guru'", [+id]); return ok(); }
      const pw = String(b.password || '');
      if (pw.length < 6) fail(400, 'Password minimal 6 karakter.');
      const h = await bcrypt.hash(pw, 10);
      if (M === 'PUT') await q("UPDATE users SET password = $1 WHERE id = $2 AND role='guru'", [h, +id]);
      else {
        const n = String(b.nama || '').trim(), us = String(b.username || '').trim();
        if (!n || !us) fail(400, 'Isi nama dan username.');
        try { await q("INSERT INTO users (nama, username, password, role) VALUES ($1,$2,$3,'guru')", [n, us, h]); } catch { fail(409, 'Username sudah dipakai.'); }
      }
      return ok();
    }
    fail(404, 'Tidak ditemukan.');
  } catch (e) {
    if (!e.s) console.error(e);
    send(e.s || 500, { error: e.s ? e.message : 'Terjadi kesalahan server.' });
  }
}
