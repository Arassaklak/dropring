// Arayüz dilleri. Yeni dil eklemek: aşağıya bir sözlük ekleyin.
(function () {
  const tr = {
    home: 'Ana sayfa', recipes: 'Tarifler', watch: 'İzlenen klasörler', settings: 'Ayarlar', about: 'Hakkında',
    dropTitle: 'Dosyaları buraya bırakın', dropSub: 'ya da tıklayıp seçin — halka açılır, formatı seçersiniz',
    recent: 'Son dönüşümler', empty: 'Henüz dönüşüm yok. İpucu: {key} tuşuna basılı tutup bir dosyayı sürükleyin.',
    undo: 'Geri al', undone: 'Geri alındı', reveal: 'Göster', open: 'Aç', copy: 'Kopyala', clear: 'Temizle', cancel: 'İptal',
    saved: 'kazanç', bigger: 'büyüdü', files: 'dosya', failed: 'hata', drop: 'Bırak', choose: 'Seç', close: 'Kapat',
    dropHere: 'Bırak', dropChoose: 'Bırak, sonra seç', more: 'Diğer', recipesRing: 'Tarifler', actions: 'İşlemler',
    newRecipe: 'Yeni tarif', resetRecipes: 'Hazır tariflere dön', save: 'Kaydet', delete: 'Sil', duplicate: 'Kopyala', addStep: 'Adım ekle',
    name: 'Ad', icon: 'Simge', appliesTo: 'Hangi dosyalarda görünsün', steps: 'Adımlar',
    newWatch: 'Klasör ekle', target: 'Hedef', recipe: 'Tarif', moveOriginals: 'Orijinalleri "İşlenenler"e taşı', enabled: 'Açık',
    general: 'Genel', trigger: 'Tetikleme', output: 'Çıktı', appearance: 'Görünüm', shortcuts: 'Kısayollar', advanced: 'Gelişmiş',
    language: 'Dil', theme: 'Tema', accent: 'Vurgu rengi', opacity: 'Halka saydamlığı', system: 'Sistem', light: 'Açık', dark: 'Koyu',
    gesture: 'Tuş + sürükle ile halkayı aç', gestureKey: 'Tetik tuşu', bubble: 'Yüzen bırakma balonu', launch: 'Oturum açılınca başlat',
    folder: 'Kayıt yeri', same: 'Orijinalin yanına', subfolder: 'Alt klasöre', downloads: 'İndirilenler', custom: 'Seçilen klasör…',
    pattern: 'Ad deseni', conflict: 'Ad çakışırsa', cRename: 'Numaralandır', cOverwrite: 'Üzerine yaz', cSkip: 'Atla',
    replace: 'Dönüşümden sonra orijinali yedeğe kaldır (geri alınabilir)', reveal2: 'Bitince klasörü göster', notify: 'Arka plan işlerinde bildirim',
    clipShortcut: 'Panodan kaydet', ringShortcut: 'Halkayı aç (panodaki dosyalarla)', clipFormat: 'Pano resmi formatı', concurrency: 'Aynı anda iş', auto: 'Otomatik',
    pinned: 'Halkada öne al', accessTitle: 'macOS izni gerekiyor', accessText: 'Option + sürükle hareketini algılamak için DropRing\'in Erişilebilirlik izni olmalı. İzin vermeden de yüzen balonu, sağ tık "Birlikte Aç"ı ve {key} kısayolunu kullanabilirsiniz.', grant: 'İzin ver',
    tokens: 'Değişkenler: {name} ad, {date} tarih, {time} saat, {n} sıra, {w}×{h} boyut, {size} dosya boyutu',
    howTitle: 'Nasıl kullanılır', how1: '{key} basılıyken bir dosyayı sürükleyin — imlecin yanında halka açılır.', how2: 'Formatın üstüne bırakın. Biraz bekletirseniz dış halkada kalite / boyut seçenekleri açılır.', how3: 'Tab ya da tekerlek: halkanın diğer yüzü (işlemler ve tarifler).',
    op_resize: 'Yeniden boyutlandır', op_quality: 'Kalite', op_strip: 'Meta verileri sil (EXIF/GPS)', op_grayscale: 'Gri tonlama', op_rotate: 'Döndür', op_target: 'Hedef boyut', op_convert: 'Dönüştür', op_trim: 'Kırp (süre)', op_fps: 'Kare hızı', op_mute: 'Sesi kaldır', op_pages: 'Sayfalar', op_rename: 'Yeniden adlandır', op_folder: 'Kayıt yeri', op_replace: 'Orijinali değiştir', op_action: 'İşlem',
    cat_image: 'Görsel', cat_video: 'Video', cat_audio: 'Ses', cat_document: 'Belge', cat_data: 'Veri', cat_archive: 'Arşiv',
    working: 'Dönüştürülüyor', done: 'Tamam', partly: 'Kısmen tamam', error: 'Hata', noTargets: 'Bu dosyalar için dönüşüm yok',
    aboutText: 'DropRing, sürükle-bırak ile çalışan, internetsiz ve açık kaynaklı bir dosya dönüştürücüdür. Dosyalarınız bilgisayarınızdan çıkmaz.',
    inspired: 'Filee\'den (KnifeLemon, MIT) esinlenmiştir.',
  };
  const en = {
    home: 'Home', recipes: 'Recipes', watch: 'Watch folders', settings: 'Settings', about: 'About',
    dropTitle: 'Drop files here', dropSub: 'or click to choose — the ring opens and you pick a format',
    recent: 'Recent conversions', empty: 'No conversions yet. Tip: hold {key} and drag a file.',
    undo: 'Undo', undone: 'Undone', reveal: 'Show', open: 'Open', copy: 'Copy', clear: 'Clear', cancel: 'Cancel',
    saved: 'saved', bigger: 'larger', files: 'files', failed: 'failed', drop: 'Drop', choose: 'Choose', close: 'Close',
    dropHere: 'Drop', dropChoose: 'Drop, then choose', more: 'More', recipesRing: 'Recipes', actions: 'Actions',
    newRecipe: 'New recipe', resetRecipes: 'Restore built-in recipes', save: 'Save', delete: 'Delete', duplicate: 'Duplicate', addStep: 'Add step',
    name: 'Name', icon: 'Icon', appliesTo: 'Show for these files', steps: 'Steps',
    newWatch: 'Add folder', target: 'Target', recipe: 'Recipe', moveOriginals: 'Move originals to "Processed"', enabled: 'On',
    general: 'General', trigger: 'Trigger', output: 'Output', appearance: 'Appearance', shortcuts: 'Shortcuts', advanced: 'Advanced',
    language: 'Language', theme: 'Theme', accent: 'Accent colour', opacity: 'Ring opacity', system: 'System', light: 'Light', dark: 'Dark',
    gesture: 'Open the ring with key + drag', gestureKey: 'Trigger key', bubble: 'Floating drop bubble', launch: 'Start at sign-in',
    folder: 'Save to', same: 'Next to the original', subfolder: 'A subfolder', downloads: 'Downloads', custom: 'Chosen folder…',
    pattern: 'Name pattern', conflict: 'If the name exists', cRename: 'Number it', cOverwrite: 'Overwrite', cSkip: 'Skip',
    replace: 'Move the original to backup after converting (undoable)', reveal2: 'Show the folder when done', notify: 'Notify for background jobs',
    clipShortcut: 'Save clipboard', ringShortcut: 'Open ring (with copied files)', clipFormat: 'Clipboard image format', concurrency: 'Parallel jobs', auto: 'Auto',
    pinned: 'Pin to ring', accessTitle: 'macOS permission needed', accessText: 'To detect Option + drag, DropRing needs Accessibility permission. Without it you can still use the floating bubble, "Open With" and the {key} shortcut.', grant: 'Grant',
    tokens: 'Tokens: {name}, {date}, {time}, {n} index, {w}×{h} size, {size} file size',
    howTitle: 'How it works', how1: 'Hold {key} and drag a file — a ring opens at your cursor.', how2: 'Drop on a format. Linger and the outer ring offers quality / size options.', how3: 'Tab or the wheel flips the ring (actions and recipes).',
    op_resize: 'Resize', op_quality: 'Quality', op_strip: 'Remove metadata (EXIF/GPS)', op_grayscale: 'Grayscale', op_rotate: 'Rotate', op_target: 'Target size', op_convert: 'Convert', op_trim: 'Trim (time)', op_fps: 'Frame rate', op_mute: 'Remove audio', op_pages: 'Pages', op_rename: 'Rename', op_folder: 'Save to', op_replace: 'Replace original', op_action: 'Action',
    cat_image: 'Image', cat_video: 'Video', cat_audio: 'Audio', cat_document: 'Document', cat_data: 'Data', cat_archive: 'Archive',
    working: 'Converting', done: 'Done', partly: 'Partly done', error: 'Error', noTargets: 'No conversions for these files',
    aboutText: 'DropRing is an offline, open-source drag-and-drop file converter. Your files never leave your computer.',
    inspired: 'Inspired by Filee (KnifeLemon, MIT).',
  };
  const dicts = { tr, en };
  let lang = (navigator.language || 'tr').toLowerCase().startsWith('tr') ? 'tr' : 'en';
  const keyName = () => (window.dropring && window.dropring.platform === 'darwin' ? '⌥ Option' : 'Ctrl');
  window.i18n = {
    set(l) { lang = l && l !== 'auto' ? l : (navigator.language || 'tr').toLowerCase().startsWith('tr') ? 'tr' : 'en'; document.documentElement.lang = lang; },
    get lang() { return lang; },
    t(k, vars = {}) { const s = (dicts[lang] && dicts[lang][k]) || tr[k] || k; return s.replace(/\{(\w+)\}/g, (m, v) => (v in vars ? vars[v] : v === 'key' ? keyName() : m)); },
    apply(root = document) { root.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = window.i18n.t(el.dataset.i18n); }); },
  };
})();
