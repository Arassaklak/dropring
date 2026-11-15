# DropRing

**Sürükle. Bırak. Dönüştü.** — Windows ve macOS için internetsiz, açık kaynaklı dosya dönüştürücü.

Tetik tuşuna (Windows: <kbd>Ctrl</kbd>, macOS: <kbd>⌥ Option</kbd>) basılıyken bir dosyayı sürükleyin; imlecin yanında bir **halka** açılır. Formatın üstüne bırakın, bitti. Biraz bekletirseniz **dış halka** açılır: kalite, boyut, hedef dosya boyutu.

Dosyalarınız bilgisayarınızdan çıkmaz. Kaynak dosyanın üzerine asla yazılmaz. Her dönüşüm **geri alınabilir**.

> [Filee](https://github.com/KnifeLemon/Filee)'den (Myeonggu Kim / KnifeLemon, MIT) esinlenmiştir. Kod sıfırdan yazılmıştır.

## Filee'den farkları

| | Filee | DropRing |
|---|---|---|
| Halka menü | Tek katman (+ Tab ile arka yüz) | **İki katman**: formatın üstünde bekleyince dış halkada kalite / boyut / hedef boyut (Filee issue #74) |
| Zincirleme işlem | Tek dönüşüm | **Tarifler**: küçült → dönüştür → EXIF sil → yeniden adlandır, tek bırakışta |
| Hedef boyut | — | **"≤ 16 MB'a sığdır"**: görselde kalite ikili arama + küçültme, videoda bit hızı hesabı |
| Geri al | — | Her iş geçmişte, tek tıkla geri alınır; "orijinali değiştir" kipinde orijinal yedekten geri gelir |
| Pano | — | Panodaki resmi tek kısayolla dosyaya kaydet; Gezgin/Finder'da kopyalanan dosyalar için halkayı aç; panodaki bağlantıyı indir |
| Video kare ayırma | İstek (issue #63) | Var (fps ve aralık seçilebilir) |
| Gizlilik | Meta veri düzenleme | Tek dilimle **gizlilik temizliği** (EXIF/GPS) |
| macOS | Önizleme, `install.sh` | `.dmg`, menü çubuğu uygulaması, izin verilmeden de **yüzen balon** ve kısayolla çalışır |
| Hazır ayarlar | Format başına araç çubuğu | Hazır tarifler: Web için, WhatsApp, Discord, E-posta, Instagram, Taramaları PDF yap |

Filee çok daha fazla format destekler (270; HWP, CAD, e-kitap, 3B…). DropRing yaygın formatlara ve iş akışına odaklanır; yeni motor eklemek tek dosyadır (aşağıda).

## Formatlar

| Kaynak | Hedef |
|---|---|
| **Görsel**: JPG, PNG, WebP, AVIF, GIF, TIFF, SVG, BMP, ICO, HEIC¹ | JPG, PNG, WebP, AVIF, GIF, TIFF, BMP, ICO (çok boyutlu), PDF |
| **Video**: MP4, MOV, MKV, WebM, AVI, WMV, FLV, MPEG, TS, 3GP | MP4 (H.264/HEVC), WebM (VP9), MOV, MKV, GIF (paletli), MP3/M4A/WAV/FLAC/OGG/Opus, kare (JPG/PNG), tüm kareler |
| **Ses**: MP3, M4A, AAC, WAV, FLAC, OGG, Opus, WMA, AIFF | MP3, M4A, WAV, FLAC, OGG, Opus |
| **Belge**: PDF, Word (DOCX), Markdown, HTML, TXT | PDF, HTML, TXT, Markdown; PDF → PNG/JPG/WebP, metin; PDF birleştir / böl / sayfa seç |
| **Tablo/Veri**: XLSX, XLS, ODS, CSV, TSV, JSON, YAML, XML | birbirine (iç içe JSON düzleştirilir; CSV'ler Excel'de Türkçe karakterlerle doğru açılır) |
| **Arşiv**: ZIP, TAR, TAR.GZ | aç, ZIP / TAR.GZ'ye çevir, dosyalardan ZIP yap |

¹ HEIC: macOS'ta yerleşik `sips`, Windows'ta "HEIF Görüntü Uzantıları" ile.

Çok adımlı yollar otomatik bulunur (ör. DOCX → HTML → PDF → PNG). Ayrı bir program kurmanız gerekmez: FFmpeg, libvips ve pdf.js uygulamayla gelir.

## Kurulum

[Sürümler](../../releases) sayfasından:

- **Windows 10/11**: `DropRing-…-win-x64-Setup.exe` (Gezgin sağ tık menüsü "DropRing ile dönüştür" ve `dropring` komutu eklenir) ya da kurulumsuz `…-Portable.exe`.
  İmzasız sürümlerde SmartScreen uyarısında *Ek bilgi → Yine de çalıştır*.
- **macOS 12+**: `DropRing-…-mac-arm64.dmg` (Apple Silicon) ya da `…-mac-x64.dmg` (Intel). Uygulamalar'a sürükleyin.
  Notarize edilmemiş sürümlerde ilk açılışta *Sistem Ayarları → Gizlilik ve Güvenlik → Yine de Aç*.
  Option + sürükle için *Erişilebilirlik* izni istenir; izin vermeden de yüzen balon, "Birlikte Aç" ve kısayolla çalışır.

## Kullanım

- **Tuş + sürükle** → halka. Dilime bırakın. Bekletin → dış halka. <kbd>Tab</kbd> / tekerlek → işlemler ve tarifler.
- **Tıklama kipi**: ana penceredeki alana bırakın, sağ tıklayıp "DropRing ile dönüştür"ü seçin ya da dosyayı kopyalayıp <kbd>Ctrl/⌘ + Alt + Space</kbd>. Ok tuşları, <kbd>Enter</kbd>, <kbd>1</kbd>–<kbd>9</kbd>.
- **Pano**: <kbd>Ctrl/⌘ + Alt + V</kbd> panodaki resmi İndirilenler'e kaydeder.
- **Tarayıcıdan**: bir resmi ya da bağlantıyı halkaya sürükleyin; indirilip dönüştürülür.
- **İzlenen klasörler**: klasöre düşen her dosya otomatik dönüşür (ör. İndirilenler'deki HEIC'ler → JPG).

## Komut satırı

```
dropring convert foto.heic --to jpg
dropring convert *.png --to webp --quality 80 --max 1920 -o cikti
dropring convert video.mov --to mp4 --target 15MB
dropring recipe "Web için" *.jpg
dropring action merge-pdf kapak.pdf tarama1.jpg tarama2.jpg
dropring watch ~/Downloads --to jpg --move-originals
dropring formats foto.png
```

Windows'ta kurulum `dropring` komutunu PATH'e ekler. macOS'ta:
`sudo ln -sf /Applications/DropRing.app/Contents/Resources/dropring /usr/local/bin/dropring`

## Geliştirme

```bash
npm install
npm start                 # uygulamayı çalıştır
npm test -- /yol/test     # motor testleri (test/engine.test.js içindeki dosya adlarıyla)
npm run dist:win          # Windows kurulumu (Windows'ta)
npm run dist:mac          # macOS dmg (macOS'ta)
```

`v1.0.0` gibi bir etiket gönderildiğinde GitHub Actions Windows ve macOS (Intel + Apple Silicon) paketlerini derleyip sürüme ekler (`.github/workflows/build.yml`). İmza sertifikası gizli değişkenleri tanımlıysa imzalar.

### Mimari

```
src/
  engine/            Arayüzden bağımsız motor (uygulama, CLI ve testler aynı kodu kullanır)
    formats.js       Format kaydı (uzantı, MIME, kategori)
    planner.js       Rota planlayıcı: Dijkstra, en çok 3 adım, directOnly/terminal kenarlar
    index.js         İş kuyruğu, eşzamanlılık, çok dosyalı işlemler, geri al
    recipes.js       Tarif derleyici, hazır tarifler, dış halka seçenekleri
    output.js        Adlandırma deseni, çakışma, yedekleme (kaynak asla ezilmez)
    converters/      image (sharp) · media (FFmpeg) · document (mammoth, marked, pdf-lib)
                     data (SheetJS, YAML, XML) · archive (zip, tar) · platform (sips, WIC)
  main/              Electron ana süreç: tepsi, pencereler, küresel kanca, pano, izleme
  ui/                Halka, ana pencere, bildirim kartı, balon (TR/EN)
  cli.js             Komut satırı
```

**Yeni motor eklemek**: `converters/` altına `{ id, name, edges: [[kaynaklar], [hedefler], maliyet], run({ input, output, from, to, opts, ctx }) }` döndüren bir dosya yazıp `engine/index.js`'teki listeye ekleyin. Planlayıcı yeni rotaları kendisi bulur.

## Lisans

MIT. Birlikte gelen bileşenler kendi lisanslarını korur (FFmpeg: GPL derlemesi — `ffmpeg-static`; libvips: LGPL; pdf.js: Apache-2.0).
