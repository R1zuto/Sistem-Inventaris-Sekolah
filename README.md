# Sistem Inventaris Sekolah (Vercel)
- `public/`  : tampilan (HTML, CSS, JS)
- `api/`     : server (Node.js) -> login, inventaris, laporan, ekspor Excel
- `schema.sql`: tabel + data awal untuk Postgres (Neon)

Environment variable di Vercel:
- DATABASE_URL          (otomatis dari integrasi Neon)
- BLOB_READ_WRITE_TOKEN (otomatis dari Vercel Blob)
- JWT_SECRET            (isi sendiri, acak, minimal 32 karakter)
