# Splicer2Go

Splicer2Go adalah utility projection mapping berbasis web yang dibangun dari fondasi **MaptasticJS**, lalu dikembangkan untuk workflow media server ringan: memuat media, slicing/cropping, warp, subdivision mesh, edge blending, scheduling clip, dan export project.

Project ini ditujukan untuk kebutuhan mapping praktis dengan kontrol keyboard/mouse yang cepat, dan tetap ringan dijalankan di hardware menengah-rendah.

## Quick Start

1. Buka `example/index.html` di browser (disarankan Chrome/Edge).
2. Tekan `Shift+Space` untuk masuk edit mode.
3. Klik tombol `I/O` di pojok kanan atas.
4. Tambahkan source lewat `Pilih File` atau `Buka Halaman Web`.
5. Pilih layer, lalu lakukan warp/slice:
- drag corner point untuk warp quad
- buka `Slice Editor (Popup)` untuk crop + subdivision + edge blend
6. Simpan hasil:
- `Save As HTML` untuk single file
- `Export Folder` untuk `index.html` + asset lokal
- `Export + Downloader` untuk mencoba mengunduh media URL ke folder export

Shortcut utama:
- `Shift+Space`: toggle edit mode
- `Arrow`: geser layer/point terpilih
- `Shift+Arrow`: geser 10 px
- `Alt+Drag`: rotate/scale layer
- `s`: solo layer terpilih
- `c`: toggle crosshair
- `b`: toggle projector bounds

## Latar Belakang

Engine ini terinspirasi dari alur kerja output mapping seperti pada Resolume Advanced Output, tetapi fokus hanya pada sisi **output mapping** di browser:

**MEDIA -> SLICE -> SURFACE MESH -> (optional) DOWNLOADER EXPORT -> FINAL CANVAS**

## Fitur Utama

- Multi-layer mapping (quad transform)
- Import source:
  - File lokal: video, image, gif, html
  - URL/web page
- Slice/Crop popup editor (click + drag + corner handle)
- Subdivision mesh warp (point editing, multi-select shift-click)
- Soft edge blending per sisi (left/right/top/bottom + gamma)
- Clip schedule per layer (multi trigger time table)
- Shortcut editing mode (`Shift+Space`) + kontrol keyboard klasik mapping
- Save/Export:
  - **Save As HTML** (single-file project)
  - **Export Folder** (index + asset lokal)
  - **Export + Downloader** (coba unduh media URL ke folder export)

## Filosofi Teknis

- Frontend-only runtime (JavaScript/CSS/Canvas)
- Interaksi editing langsung di canvas/output
- Struktur modular di level data layer:
  - source
  - slice
  - mesh
  - edgeBlend
  - schedule

## Kredit dan Sumber Induk

Project ini merupakan pengembangan dari:

- **MaptasticJS (source induk)**  
  https://github.com/glowbox/maptasticjs

Splicer2Go mempertahankan semangat Maptastic sebagai utility mapping yang simple dan cepat, sambil menambahkan fitur workflow modern untuk kebutuhan projection mapping berbasis media.

## Catatan

- Untuk fitur `Export Folder` dan `Export + Downloader`, gunakan browser yang mendukung File System Access API (Chrome/Edge modern).
- Downloader URL bergantung pada akses CORS dari server sumber media.
#
