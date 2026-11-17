const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const badge = k => `<span class="badge b-${String(k).replace(' ', '-')}">${esc(k)}</span>`;
const opts = (a, s) => a.map(x => `<option ${x === s ? 'selected' : ''}>${x}</option>`).join('');
const tgl = d => new Date(d).toLocaleDateString('id-ID');
const foto = f => f ? `<a href="${esc(f)}" target="_blank"><img class="thumb" src="${esc(f)}"></a>` : '-';
const tbl = (h, rows, empty = 'Tidak ada data.') => `<div class="tbl"><table><tr>${h.map(x => `<th>${x}</th>`).join('')}</tr>${rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('') || `<tr><td colspan="${h.length}" class="muted">${empty}</td></tr>`}</table></div>`;
const KOND = ['layak', 'tidak layak'], STATUS = ['Menunggu', 'Diproses', 'Selesai', 'Ditolak'], KAT = ['Kelas 7', 'Kelas 8', 'Kelas 9', 'Fasilitas', 'Kantor'];
const MENU = {
  admin: [['dashboard', '📊 Dashboard'], ['ruangan', '🏫 Ruangan'], ['inventaris', '📦 Inventaris'], ['laporan', '🛠️ Laporan Kerusakan'], ['guru', '👩‍🏫 Kelola Guru']],
  guru: [['ruangan', '🏫 Daftar Ruangan'], ['lapor', '📝 Lapor Kerusakan'], ['riwayat', '📋 Laporan Saya']]
};
let me = null, charts = [], rooms = [], fotoData = '', tm;

async function api(path, method = 'GET', body) {
  const r = await fetch('/api/' + path, { method, headers: method === 'GET' ? {} : { 'Content-Type': 'application/json' }, body: method === 'GET' ? undefined : JSON.stringify(body || {}) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) { if (r.status === 401 && me) location.reload(); throw new Error(d.error || 'Terjadi kesalahan.'); }
  return d;
}
const run = async f => { try { await f(); } catch (e) { alert(e.message); } };
const form = e => { e.preventDefault(); return Object.fromEntries(new FormData(e.target)); };
const openModal = h => { $('#box').innerHTML = h; $('#modal').hidden = false; };
const closeModal = () => $('#modal').hidden = true;
$('#modal').onclick = e => e.target.id === 'modal' && closeModal();

/* ---------- Login ---------- */
async function boot() {
  try { me = await api('me'); start(); } catch { $('#login').hidden = false; }
}
$('#loginForm').onsubmit = async e => {
  e.preventDefault();
  try { me = await api('login', 'POST', { username: $('#u').value, password: $('#p').value }); $('#login').hidden = true; start(); }
  catch (er) { $('#err').textContent = er.message; }
};
$('#logout').onclick = async () => { await api('logout', 'POST').catch(() => {}); location.reload(); };
$('#nav').onclick = e => e.target.dataset.v && go(e.target.dataset.v);
function start() {
  $('#login').hidden = true; $('#app').hidden = false;
  $('#meName').textContent = me.nama; $('#meRole').textContent = me.role;
  $('#nav').innerHTML = MENU[me.role].map(m => `<button data-v="${m[0]}">${m[1]}</button>`).join('');
  go(MENU[me.role][0][0]);
}
function go(v) {
  charts.forEach(c => c.destroy()); charts = [];
  document.querySelectorAll('#nav button').forEach(b => b.classList.toggle('on', b.dataset.v === v));
  $('#title').textContent = MENU[me.role].find(m => m[0] === v)[1].slice(3);
  $('#view').innerHTML = '<p class="muted">Memuat...</p>';
  run(VIEWS[v]);
}

/* ---------- Halaman ---------- */
const VIEWS = {
  async dashboard() {
    const s = await api('stats'), kv = KOND.map(x => s.kondisi[x] || 0);
    const st = [['Ruangan', s.ruangan], ['Total Barang', kv[0] + kv[1]], ['Layak', kv[0]], ['Tidak Layak', kv[1]], ['Laporan Menunggu', s.menunggu]];
    $('#view').innerHTML = `<div class="grid">${st.map(x => `<div class="card stat"><b>${x[1]}</b><span>${x[0]}</span></div>`).join('')}</div>
      <div class="charts"><div class="card"><h3>Kondisi Barang</h3><div class="chartbox"><canvas id="c1"></canvas></div></div>
      <div class="card"><h3>Barang Tidak Layak per Ruangan</h3><div class="chartbox"><canvas id="c2"></canvas></div></div></div>`;
    charts.push(new Chart($('#c1'), { type: 'doughnut', data: { labels: KOND, datasets: [{ data: kv, backgroundColor: ['#16a34a', '#dc2626'] }] }, options: { maintainAspectRatio: false } }));
    charts.push(new Chart($('#c2'), { type: 'bar', data: { labels: s.per.map(x => x.n), datasets: [{ label: 'Jumlah tidak layak', data: s.per.map(x => x.j), backgroundColor: '#2563eb' }] }, options: { maintainAspectRatio: false } }));
  },
  async ruangan() {
    rooms = await api('ruangan');
    $('#view').innerHTML = `<div class="grid">${rooms.map(r => `<div class="card room"><b>${esc(r.nama_ruangan)}</b><small>${r.kategori} · ${r.jenis} jenis barang · ${r.rusak} tidak layak</small><button class="btn sm" onclick="lihatRuang(${r.id})">Lihat barang</button></div>`).join('')}</div>`;
  },
  async inventaris() {
    rooms = await api('ruangan');
    $('#view').innerHTML = `<div class="card tools" style="margin-bottom:14px">
      <button class="btn" onclick="formItem()">+ <span class="x">Tambah </span>Barang<span class="x"> Baru</span></button>
      <button class="btn ghost" onclick="formRuang()">🏫 <span class="x">Tambah </span>Ruangan</button>
      <button class="btn red" onclick="formHapusRuang()">🗑 Hapus<span class="x"> Ruangan</span></button></div>
      <div class="card"><div class="bar"><input id="q" placeholder="Cari barang..." oninput="clearTimeout(tm);tm=setTimeout(tabelItem,250)">
      <select id="fr" onchange="tabelItem()"><option value="">Semua ruangan</option>${rooms.map(r => `<option value="${r.id}">${esc(r.nama_ruangan)}</option>`).join('')}</select>
      <select id="fk" onchange="tabelItem()"><option value="">Semua kondisi</option>${opts(KOND)}</select>
      <a class="btn ghost" id="exp" href="/api/export">⬇ Ekspor Excel</a></div><div id="tb"></div></div>`;
    tabelItem();
  },
  async laporan() {
    const rs = await api('laporan');
    $('#view').innerHTML = `<div class="card">${tbl(['Tanggal', 'Pelapor', 'Ruangan / Barang', 'Deskripsi', 'Foto', 'Status & Catatan'], rs.map(r => [tgl(r.tanggal_lapor), esc(r.pelapor), `${esc(r.nama_ruangan)}<br><b>${esc(r.nama_barang)}</b>`, esc(r.deskripsi), foto(r.foto),
      `<div class="inl"><select id="s${r.id}">${opts(STATUS, r.status)}</select><input id="c${r.id}" placeholder="Catatan" value="${esc(r.catatan_admin)}"><button class="btn sm" onclick="simpanLap(${r.id})">Simpan</button></div>`]), 'Belum ada laporan.')}</div>`;
  },
  async guru() {
    const gs = await api('guru');
    $('#view').innerHTML = `<div class="card" style="margin-bottom:14px"><h3>Tambah Guru</h3><form class="bar" onsubmit="tambahGuru(event)">
      <input name="nama" placeholder="Nama lengkap" required><input name="username" placeholder="Username" required><input name="password" placeholder="Password (min. 6)" required><button class="btn">Tambah</button></form></div>
      <div class="card">${tbl(['Nama', 'Username', 'Aksi'], gs.map(g => [esc(g.nama), esc(g.username), `<button class="btn sm ghost" onclick="resetPw(${g.id})">Reset password</button><button class="btn sm red" onclick="hapusGuru(${g.id})">Hapus</button>`]), 'Belum ada akun guru.')}</div>`;
  },
  async lapor() {
    const its = await api('inventaris'); let g = '', h = '';
    for (const i of its) { if (g !== i.nama_ruangan) { if (g) h += '</optgroup>'; g = i.nama_ruangan; h += `<optgroup label="${esc(g)}">`; } h += `<option value="${i.id}">${esc(i.nama_barang)}</option>`; }
    fotoData = '';
    $('#view').innerHTML = `<form class="card" style="max-width:520px;display:grid;gap:12px" onsubmit="kirimLap(event)">
      <label>Ruangan &amp; Barang<select name="inventaris_id" required><option value="">-- pilih barang --</option>${h}${g ? '</optgroup>' : ''}</select></label>
      <label>Deskripsi Kerusakan<textarea name="deskripsi" required placeholder="Jelaskan kerusakannya..."></textarea></label>
      <label>Foto Kerusakan (opsional)<input type="file" accept="image/*" onchange="pilihFoto(this)"></label><img id="lp" class="thumb big" hidden>
      <button class="btn">Kirim Laporan</button></form>`;
  },
  async riwayat() {
    const rs = await api('laporan');
    $('#view').innerHTML = `<div class="card">${tbl(['Tanggal', 'Ruangan', 'Barang', 'Deskripsi', 'Foto', 'Status', 'Catatan Admin'], rs.map(r => [tgl(r.tanggal_lapor), esc(r.nama_ruangan), esc(r.nama_barang), esc(r.deskripsi), foto(r.foto), badge(r.status), esc(r.catatan_admin)]), 'Belum ada laporan yang Anda kirim.')}</div>`;
  }
};

/* ---------- Ruangan & Inventaris ---------- */
const lihatRuang = id => run(async () => {
  const it = await api('inventaris?r=' + id);
  openModal(`<h3>${esc(rooms.find(r => r.id === id)?.nama_ruangan)}</h3>${tbl(['Barang', 'Jumlah', 'Kondisi', 'Keterangan'], it.map(i => [esc(i.nama_barang), i.jumlah, badge(i.kondisi), esc(i.keterangan)]), 'Belum ada barang.')}<div class="actions"><button class="btn ghost" onclick="closeModal()">Tutup</button></div>`);
});
const tabelItem = () => run(async () => {
  const p = new URLSearchParams({ q: $('#q').value, r: $('#fr').value, k: $('#fk').value });
  $('#exp').href = '/api/export?' + p;
  window.items = await api('inventaris?' + p);
  $('#tb').innerHTML = tbl(['Ruangan', 'Barang', 'Jumlah', 'Kondisi', 'Keterangan', 'Aksi'], items.map(i => [esc(i.nama_ruangan), esc(i.nama_barang), i.jumlah, badge(i.kondisi), esc(i.keterangan),
    `<button class="btn sm" onclick="formItem(${i.id})">Edit</button><button class="btn sm red" onclick="hapusItem(${i.id})">Hapus</button>`]));
});
function formItem(id) {
  const i = id ? items.find(x => x.id === id) : { ruangan_id: +($('#fr').value || rooms[0].id), nama_barang: '', jumlah: 1, kondisi: 'layak', keterangan: '' };
  openModal(`<h3>${id ? 'Edit' : 'Tambah'} Barang</h3><form style="display:grid;gap:10px" onsubmit="simpanItem(event,${id || 0})">
    <label>Ruangan<select name="ruangan_id">${rooms.map(r => `<option value="${r.id}" ${r.id === i.ruangan_id ? 'selected' : ''}>${esc(r.nama_ruangan)}</option>`).join('')}</select></label>
    <label>Nama Barang<input name="nama" required value="${esc(i.nama_barang)}"></label>
    <label>Jumlah<input name="jumlah" type="number" min="1" required value="${i.jumlah}"></label>
    <label>Kondisi<select name="kondisi">${opts(KOND, i.kondisi)}</select></label>
    <label>Keterangan<input name="keterangan" value="${esc(i.keterangan)}"></label>
    <div class="actions"><button type="button" class="btn ghost" onclick="closeModal()">Batal</button><button class="btn">Simpan</button></div></form>`);
}
const simpanItem = (e, id) => { const f = form(e); run(async () => { await api(id ? 'inventaris/' + id : 'inventaris', id ? 'PUT' : 'POST', f); closeModal(); tabelItem(); }); };
const hapusItem = id => confirm('Hapus barang ini?') && run(async () => { await api('inventaris/' + id, 'DELETE'); tabelItem(); });
const formRuang = () => openModal(`<h3>Tambah Ruangan</h3><form style="display:grid;gap:10px" onsubmit="simpanRuang(event)">
  <label>Nama Ruangan<input name="nama" required placeholder="mis. Ruang Musik"></label><label>Kategori<select name="kategori">${opts(KAT, 'Fasilitas')}</select></label>
  <div class="actions"><button type="button" class="btn ghost" onclick="closeModal()">Batal</button><button class="btn">Tambah</button></div></form>`);
const simpanRuang = e => { const f = form(e); run(async () => { await api('ruangan', 'POST', f); closeModal(); go('inventaris'); }); };
const formHapusRuang = () => openModal(`<h3>Hapus Ruangan</h3><p class="muted">Semua barang dan laporan kerusakan di ruangan itu ikut terhapus. Tidak bisa dibatalkan.</p>
  <form style="display:grid;gap:10px" onsubmit="hapusRuang(event)"><select name="id" required><option value="">-- pilih ruangan --</option>${rooms.map(r => `<option value="${r.id}">${esc(r.nama_ruangan)} (${r.jenis} jenis barang)</option>`).join('')}</select>
  <div class="actions"><button type="button" class="btn ghost" onclick="closeModal()">Batal</button><button class="btn red">Hapus</button></div></form>`);
const hapusRuang = e => { const f = form(e); confirm('Yakin hapus ruangan ini beserta semua isinya?') && run(async () => { await api('ruangan/' + f.id, 'DELETE'); closeModal(); go('inventaris'); }); };

/* ---------- Laporan ---------- */
const simpanLap = id => run(async () => { await api('laporan/' + id, 'PUT', { status: $('#s' + id).value, catatan: $('#c' + id).value }); alert('Tersimpan.'); });
function pilihFoto(inp) {
  fotoData = ''; $('#lp').hidden = true;
  const file = inp.files[0]; if (!file) return;
  const img = new Image();
  img.onload = () => {
    const sc = Math.min(1, 1000 / Math.max(img.width, img.height)), c = document.createElement('canvas');
    c.width = img.width * sc; c.height = img.height * sc;
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    fotoData = c.toDataURL('image/jpeg', 0.75); $('#lp').src = fotoData; $('#lp').hidden = false;
  };
  img.src = URL.createObjectURL(file);
}
const kirimLap = e => { const f = form(e); run(async () => { await api('laporan', 'POST', { ...f, foto: fotoData }); fotoData = ''; alert('Laporan terkirim!'); go('riwayat'); }); };

/* ---------- Guru ---------- */
const tambahGuru = e => { const f = form(e); run(async () => { await api('guru', 'POST', f); go('guru'); }); };
const resetPw = id => { const p = prompt('Password baru (min. 6 karakter):'); p && run(async () => { await api('guru/' + id, 'PUT', { password: p }); alert('Password diubah.'); }); };
const hapusGuru = id => confirm('Hapus akun guru ini?') && run(async () => { await api('guru/' + id, 'DELETE'); go('guru'); });

boot();
