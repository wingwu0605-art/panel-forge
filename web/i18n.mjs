/**
 * i18n.mjs —— 界面语言切换（中文 / English / Bahasa Indonesia）
 *
 * 为什么用「DOM 原文映射」而不是把全站改成 t('key')：
 * 这个项目有 250+ 条界面文案散在 index.html 和 app.js 的模板字符串里，
 * 逐个改成 key 是一次高风险的大手术，还会把模板可读性毁掉。
 * 这里的做法是：**记住每个文本节点的原文**，渲染后按词典把中文换成目标语言。
 * 好处：
 *   - 源码保持中文可读；加一条翻译只是往词典里加一行
 *   - 动态生成的界面（右栏、候选图、toast、面板列表）自动跟着翻
 *   - 词典里没有的串保持中文，不会变成 key 或空白
 * 代价：切语言时要遍历一次 DOM（用 rAF 批量，且只在有变化时跑）。
 */

export const LANGS = [
  { id: 'zh', label: '中文' },
  { id: 'en', label: 'English' },
  { id: 'id', label: 'Bahasa Indonesia' },
];

/** 中文 → English */
const EN = {
  // ---- 外壳 / 顶栏 ----
  '分镜坊': 'Storyboard Forge',
  '载入中…': 'Loading…',
  '面板管理': 'Panels',
  'API 文档': 'API docs',
  '全部模板接触表': 'Template sheet',
  'AI 工具定义': 'AI tools',
  '静态态插件': 'Static',
  '外观': 'Appearance',
  '自动': 'Auto',
  '浅色': 'Light',
  '深色': 'Dark',
  '强调色': 'Accent',
  '蓝色': 'Blue',
  '界面风格': 'Style',
  '经典': 'Classic',
  '液态玻璃': 'Liquid Glass',
  '减弱动态效果': 'Reduce motion',
  '语言': 'Language',

  // ---- 剧情卡 ----
  '剧情 → 分镜': 'Plot → storyboard',
  '本地规则引擎': 'Local rule engine',
  '画风体系': 'Art style',
  '自动判断': 'Auto-detect',
  '日式页漫（右→左）': 'Japanese manga (RTL)',
  '中式漫画（条漫/国风）': 'Chinese comic (webtoon)',
  '韩式条漫（竖屏 webtoon）': 'Korean webtoon',
  '画幅': 'Format',
  '页漫（A4/B5）': 'Page (A4/B5)',
  '条漫（竖屏滚动）': 'Vertical scroll',
  '横版 / 跨页': 'Landscape / spread',
  '方形': 'Square',
  '按规则匹配': 'Match by rules',
  '让 AI 排戏': 'Let AI direct',
  '本地规则引擎：—': 'Local rule engine: —',

  // ---- AI 导演卡 ----
  'AI 导演': 'AI director',
  '可选': 'Optional',
  '未配置': 'Not set',
  '未配置 Key': 'No API key',
  '规则路照常可用，AI 是可选加速': 'Rules always work — AI is optional',
  '输入 Key': 'Enter key',
  '未配置 · 规则路仍然可用': 'Not set · rules still work',
  '规则路照常可用（AI 路需你填 Key，或设 LLM_API_KEY）':
    'rules always work (AI needs a key, or set LLM_API_KEY)',
  '规则路照常可用，AI 是可选加速': 'rules always work, AI is an optional speed-up',
  'OpenAI 兼容': 'OpenAI-compatible',
  '硅基流动': 'SiliconFlow',
  '仅本次会话': 'This session only',
  '测试连接': 'Test connection',
  '清除配置': 'Clear',
  '角色设定（可选，保证每格同一张脸）': 'Character brief (optional, keeps the same face)',
  'AI 自动决定并排戏': 'Let AI pick and direct',
  'AI 生成': 'AI image',
  '生图': 'Image',
  '只写提示词': 'Prompt only',
  '生这一格': 'Generate this panel',
  '这一格的候选图': 'Candidates',
  '换一张': 'Another',
  '清空候选': 'Clear candidates',
  '生图提示词 ·': 'Image prompt ·',
  '恢复自动': 'Reset to auto',
  '避免出现': 'Avoid',
  '实际发给生图模型的完整内容': 'What is actually sent to the model',

  // ---- 角色卡 ----
  '角色参考图': 'Character references',
  '让同一个人每格都长一样': 'Same face in every panel',
  '选参考图（1–3 张）': 'Pick references (1–3)',
  '清空角色': 'Clear characters',
  '还没有角色卡。加一张参考图，以后每次生图都会自动带上。': 'No characters yet. Add a reference and it is applied to every generation.',
  '导出角色卡': 'Export characters',
  '导入角色卡': 'Import characters',

  // ---- 模板库 ----
  '分镜模板库': 'Template library',
  '全部': 'All',
  '日': 'JP',
  '中': 'CN',
  '韩': 'KR',
  '通': 'Core',
  '格数': 'Panels',
  '题材': 'Genre',
  '标签': 'Tags',
  '清除筛选': 'Clear filters',
  '搜索：斜切 / 少女 / 九格 / 四格 / 战斗 / 留白': 'Search: diagonal / girl / 9-panel / 4-panel / action / whitespace',

  // ---- 画布工具条 ----
  '选择一套分镜': 'Pick a layout',
  '按顺序填充': 'Fill in order',
  '示例': 'Demo',
  '清空图片': 'Clear images',
  '镂空': 'Hollow',
  '格号': 'No.',
  '快捷键': 'Keys',
  '交接关系': 'Context',
  '交代关系': 'Context',
  '拖图片进画布即可填充（自动裁切到格子形状，斜切格也不会变形）':
    'Drop images on the canvas — they are clipped to the panel shape',
  '页': 'Page',
  '加一页': 'Add page',
  '导出全部页': 'Export all pages',
  '清空草稿': 'Clear draft',

  // ---- 右栏 ----
  '格子': 'Panel',
  '导出': 'Export',
  '还没有选中格子。': 'No panel selected.',
  '点画布里的任意一格开始；也可以直接在画布上拖入图片。':
    'Click any panel to start, or drop images straight on the canvas.',
  '绘制': 'Draw',
  '这一格说什么': 'Panel text',
  '本格句子 ·': 'Line ·',
  '放进气泡': 'To bubble',
  '思路': 'Idea',
  '填进去': 'Use',
  '这一格的分镜': 'Panel detail',
  '空格子': 'Empty panel',
  '空格子 · 点击下方按钮或拖入图片': 'Empty panel · pick an image below or drop one here',
  '选图片填入此格': 'Pick an image',
  '绘制这一格': 'Draw this panel',
  '用图片链接': 'From URL',
  '移除图片': 'Remove image',
  '导出这一格的图': 'Export this panel',
  '缩放': 'Zoom',
  '填满 / 完整': 'Cover / contain',
  '复位位置': 'Reset',
  '复制': 'Copy',
  '复制英文': 'Copy EN',
  '复制中文': 'Copy ZH',
  '中文版 ·': 'Chinese ·',
  '喂国内模型更稳': 'better for CN models',
  '形状开头词 ·': 'Shape prefix ·',
  '景别': 'Shot',
  '节拍': 'Beat',
  '画面': 'Content',
  '台词': 'Dialogue',
  '构图': 'Composition',
  '英文提示词': 'English prompt',
  '中文提示词': 'Chinese prompt',
  '逐格分镜表': 'Panel-by-panel sheet',
  '分镜表': 'Sheet',
  'AI 优化提示词': 'AI-optimize prompts',
  'AI 切原文': 'AI split text',
  '切分中…': 'Splitting…',
  'AI 正在把源文本切成每格…': 'AI is splitting the source text into panels…',
  '先在左栏粘贴源文本': 'Paste the source text in the left column first',
  '切分失败': 'Split failed',
  '切分出错': 'Split error',
  '复制全部': 'Copy all',
  '下载分镜表 .md': 'Download sheet .md',
  '重新生成': 'Regenerate',
  '导出宽度': 'Export width',
  '无框模板保留虚线轮廓': 'Keep dashed outline for borderless',
  '导出 PNG（整页）': 'Export PNG (page)',
  '导出 SVG（矢量）': 'Export SVG (vector)',
  '导出 JSON（模板＋图位）': 'Export JSON (layout + slots)',
  '导出空模板（镂空 SVG）': 'Export blank template (SVG)',

  // ---- 气泡 dock ----
  '气泡': 'Bubbles',
  '样式': 'Style',
  '点下面的气泡就能换样式': 'Click a bubble below to restyle it',
  '配这段字': 'fits this line',
  '已经是这个样式了': 'Already this style',
  '样式换成': 'Style changed to',
  '推荐': 'Suggested',
  '常用': 'Frequent',
  '清空': 'Clear',
  '透明度': 'Opacity',
  '大小': 'Size',
  '文字': 'Text',
  '旋转': 'Rotate',
  '删除': 'Delete',

  // ---- 手机底栏 ----
  '模板库': 'Library',
  '剧情': 'Plot',
  '画布': 'Canvas',
  '编辑': 'Edit',
  '分镜与导出': 'Sheet & export',
  '完成': 'Done',
  '说什么': 'Text',
  '图片': 'Image',
  '分镜': 'Detail',
  '编辑这一格': 'Edit panel',

  // ---- 面板管理 ----
  '左栏每一块都能隐藏或调顺序 · 记住': 'Hide or reorder any block · remembered',
  '关闭': 'Close',
  '启用 AI 功能（AI 导演 / 生图 / 优化提示词 / API Key）': 'Enable AI (director / images / prompts / API key)',
  '恢复默认': 'Reset to default',
  '隐藏': 'Hide',
  '显示': 'Show',
  '怎么用': 'How to use',

  // ---- Key 面板 ----
  'API Key 管理': 'API keys',
  '打勾的那个就是当前用的服务商 · 可以存多家随时切': 'The checked one is active · switch anytime',
  '添加 / 编辑': 'Add / edit',
  '服务商': 'Provider',
  '自定义 / 中转': 'Custom / proxy',
  '协议': 'Protocol',
  '对话模型': 'Chat model',
  '只存在你浏览器': 'stored in your browser',
  '生图服务商': 'Image provider',
  '生图模型': 'Image model',
  '保存并使用': 'Save and use',

  // ---- 绘制页 ----
  '取消': 'Cancel',
  '笔': 'Pen',
  '橡皮': 'Eraser',
  '撤销': 'Undo',
  '重做': 'Redo',
  '笔迹出不了这一格；iPad 支持压感，笔在画时手指不会误触。':
    'Strokes cannot leave this panel; Apple Pencil pressure is supported.',

  // ---- 提示 / 状态 ----
  '已复制': 'Copied',
  '已保存': 'Saved',
  '已导出': 'Exported',
  '已载入': 'Loaded',
  '未命名': 'Untitled',
  '上一格 / 下一格': 'Previous / next panel',
  '跳到第 N 格': 'Jump to panel N',
  '跳到下一个空格': 'Next empty panel',
  '按规则匹配剧情': 'Match plot by rules',
  '填满 ↔ 完整': 'Cover ↔ contain',
  '复位（位置+缩放）': 'Reset position and zoom',
  '格内拖动平移': 'Drag to pan',
  '拖拽': 'Drag',
  '格内缩放': 'Zoom in panel',
  '滚轮': 'Wheel',
  '导出 PNG / SVG': 'Export PNG / SVG',
  '选中 / 拖动': 'Select / drag',
  '点击': 'Click',
  '微调位置（Shift 加速）': 'Nudge (Shift = faster)',
  '缩小 / 放大': 'Shrink / grow',
  '复制气泡': 'Duplicate bubble',
  '删除选中（图/气泡）': 'Delete selection',
  '取消选择': 'Deselect',
  '剪切': 'Cut',
  '粘贴': 'Paste',
};

/** 中文 → Bahasa Indonesia */
const ID = {
  '分镜坊': 'Studio Papan Cerita',
  '载入中…': 'Memuat…',
  '面板管理': 'Panel',
  'API 文档': 'Dokumentasi API',
  '全部模板接触表': 'Daftar template',
  'AI 工具定义': 'Alat AI',
  '外观': 'Tampilan',
  '自动': 'Otomatis',
  '浅色': 'Terang',
  '深色': 'Gelap',
  '强调色': 'Warna aksen',
  '蓝色': 'Biru',
  '界面风格': 'Gaya antarmuka',
  '经典': 'Klasik',
  '液态玻璃': 'Kaca cair',
  '减弱动态效果': 'Kurangi animasi',
  '语言': 'Bahasa',

  '剧情 → 分镜': 'Alur cerita → papan cerita',
  '本地规则引擎': 'Mesin aturan lokal',
  '画风体系': 'Gaya gambar',
  '自动判断': 'Deteksi otomatis',
  '日式页漫（右→左）': 'Manga Jepang (kanan→kiri)',
  '中式漫画（条漫/国风）': 'Komik Tiongkok (webtoon)',
  '韩式条漫（竖屏 webtoon）': 'Webtoon Korea',
  '画幅': 'Format',
  '页漫（A4/B5）': 'Halaman (A4/B5)',
  '条漫（竖屏滚动）': 'Gulir vertikal',
  '横版 / 跨页': 'Lanskap / dua halaman',
  '方形': 'Persegi',
  '按规则匹配': 'Cocokkan dengan aturan',
  '让 AI 排戏': 'Biarkan AI menyusun',
  '本地规则引擎：—': 'Mesin aturan lokal: —',

  'AI 导演': 'Sutradara AI',
  '可选': 'Opsional',
  '未配置': 'Belum diatur',
  '未配置 Key': 'Belum ada API key',
  '规则路照常可用，AI 是可选加速': 'Aturan selalu bisa dipakai — AI opsional',
  '输入 Key': 'Masukkan key',
  '未配置 · 规则路仍然可用': 'Belum diatur · aturan tetap jalan',
  '规则路照常可用（AI 路需你填 Key，或设 LLM_API_KEY）':
    'aturan selalu jalan (AI perlu key, atau set LLM_API_KEY)',
  '规则路照常可用，AI 是可选加速': 'Aturan selalu bisa dipakai — AI opsional',
  'OpenAI 兼容': 'Kompatibel OpenAI',
  '硅基流动': 'SiliconFlow',
  '仅本次会话': 'Hanya sesi ini',
  '测试连接': 'Uji koneksi',
  '清除配置': 'Hapus',
  '角色设定（可选，保证每格同一张脸）': 'Catatan karakter (opsional, wajah tetap sama)',
  'AI 自动决定并排戏': 'Biarkan AI memilih dan menyusun',
  'AI 生成': 'Gambar AI',
  '生图': 'Gambar',
  '只写提示词': 'Hanya prompt',
  '生这一格': 'Buat panel ini',
  '这一格的候选图': 'Kandidat panel ini',
  '换一张': 'Ganti',
  '清空候选': 'Kosongkan kandidat',
  '生图提示词 ·': 'Prompt gambar ·',
  '恢复自动': 'Kembali otomatis',
  '避免出现': 'Hindari',
  '实际发给生图模型的完整内容': 'Isi lengkap yang dikirim ke model',

  '角色参考图': 'Referensi karakter',
  '让同一个人每格都长一样': 'Wajah sama di setiap panel',
  '选参考图（1–3 张）': 'Pilih referensi (1–3)',
  '清空角色': 'Hapus karakter',
  '还没有角色卡。加一张参考图，以后每次生图都会自动带上。': 'Belum ada karakter. Tambahkan referensi dan akan dipakai setiap kali.',
  '导出角色卡': 'Ekspor karakter',
  '导入角色卡': 'Impor karakter',

  '分镜模板库': 'Perpustakaan template',
  '全部': 'Semua',
  '日': 'JP',
  '中': 'CN',
  '韩': 'KR',
  '通': 'Umum',
  '格数': 'Jumlah panel',
  '题材': 'Genre',
  '标签': 'Tag',
  '清除筛选': 'Hapus filter',
  '搜索：斜切 / 少女 / 九格 / 四格 / 战斗 / 留白': 'Cari: diagonal / gadis / 9 panel / 4 panel / aksi / ruang kosong',

  '选择一套分镜': 'Pilih tata letak',
  '按顺序填充': 'Isi berurutan',
  '示例': 'Contoh',
  '清空图片': 'Hapus gambar',
  '镂空': 'Kosong',
  '格号': 'No.',
  '快捷键': 'Keys',
  '交接关系': 'Konteks',
  '交代关系': 'Konteks',
  '拖图片进画布即可填充（自动裁切到格子形状，斜切格也不会变形）':
    'Seret gambar ke kanvas — otomatis dipotong sesuai bentuk panel',
  '页': 'Halaman',
  '加一页': 'Tambah halaman',
  '导出全部页': 'Ekspor semua halaman',
  '清空草稿': 'Hapus draf',

  '格子': 'Panel',
  '导出': 'Ekspor',
  '还没有选中格子。': 'Belum ada panel dipilih.',
  '点画布里的任意一格开始；也可以直接在画布上拖入图片。':
    'Klik panel mana pun untuk mulai, atau seret gambar ke kanvas.',
  '绘制': 'Gambar',
  '这一格说什么': 'Teks panel ini',
  '本格句子 ·': 'Kalimat ·',
  '放进气泡': 'Jadikan balon',
  '思路': 'Saran',
  '填进去': 'Isi',
  '这一格的分镜': 'Detail panel ini',
  '空格子': 'Panel kosong',
  '空格子 · 点击下方按钮或拖入图片': 'Panel kosong · pilih gambar di bawah atau seret ke sini',
  '选图片填入此格': 'Pilih gambar',
  '绘制这一格': 'Gambar panel ini',
  '用图片链接': 'Dari tautan',
  '移除图片': 'Hapus gambar',
  '导出这一格的图': 'Ekspor panel ini',
  '缩放': 'Perbesar',
  '填满 / 完整': 'Penuh / utuh',
  '复位位置': 'Reset',
  '复制': 'Salin',
  '复制英文': 'Salin EN',
  '复制中文': 'Salin ZH',
  '中文版 ·': 'Versi Mandarin ·',
  '喂国内模型更稳': 'lebih stabil untuk model CN',
  '形状开头词 ·': 'Awalan bentuk ·',
  '景别': 'Ukuran bidikan',
  '节拍': 'Ketukan',
  '画面': 'Isi gambar',
  '台词': 'Dialog',
  '构图': 'Komposisi',
  '英文提示词': 'Prompt Inggris',
  '中文提示词': 'Prompt Mandarin',
  '逐格分镜表': 'Lembar per panel',
  '分镜表': 'Lembar',
  'AI 优化提示词': 'Optimalkan prompt dengan AI',
  'AI 切原文': 'AI potong teks',
  '切分中…': 'Memotong…',
  'AI 正在把源文本切成每格…': 'AI sedang memotong teks sumber per panel…',
  '先在左栏粘贴源文本': 'Tempel teks sumber di kolom kiri dulu',
  '切分失败': 'Gagal memotong',
  '切分出错': 'Kesalahan memotong',
  '复制全部': 'Salin semua',
  '下载分镜表 .md': 'Unduh lembar .md',
  '重新生成': 'Buat ulang',
  '导出宽度': 'Lebar ekspor',
  '无框模板保留虚线轮廓': 'Pertahankan garis putus-putus',
  '导出 PNG（整页）': 'Ekspor PNG (halaman)',
  '导出 SVG（矢量）': 'Ekspor SVG (vektor)',
  '导出 JSON（模板＋图位）': 'Ekspor JSON (tata letak + slot)',
  '导出空模板（镂空 SVG）': 'Ekspor template kosong (SVG)',

  '气泡': 'Balon',
  '样式': 'Gaya',
  '点下面的气泡就能换样式': 'Klik balon di bawah untuk mengganti gaya',
  '配这段字': 'cocok untuk teks ini',
  '已经是这个样式了': 'Sudah gaya ini',
  '样式换成': 'Gaya diganti ke',
  '推荐': 'Saran',
  '常用': 'Sering',
  '清空': 'Kosongkan',
  '透明度': 'Transparansi',
  '大小': 'Ukuran',
  '文字': 'Teks',
  '旋转': 'Putar',
  '删除': 'Hapus',

  '模板库': 'Perpustakaan',
  '剧情': 'Alur',
  '画布': 'Kanvas',
  '编辑': 'Edit',
  '分镜与导出': 'Lembar & ekspor',
  '完成': 'Selesai',
  '说什么': 'Teks',
  '图片': 'Gambar',
  '分镜': 'Detail',
  '编辑这一格': 'Edit panel',

  '左栏每一块都能隐藏或调顺序 · 记住': 'Sembunyikan atau ubah urutan blok · diingat',
  '关闭': 'Tutup',
  '启用 AI 功能（AI 导演 / 生图 / 优化提示词 / API Key）': 'Aktifkan AI (sutradara / gambar / prompt / API key)',
  '恢复默认': 'Kembalikan default',
  '隐藏': 'Sembunyikan',
  '显示': 'Tampilkan',
  '怎么用': 'Cara pakai',

  'API Key 管理': 'Kelola API key',
  '打勾的那个就是当前用的服务商 · 可以存多家随时切': 'Yang dicentang sedang dipakai · bisa disimpan banyak',
  '添加 / 编辑': 'Tambah / ubah',
  '服务商': 'Penyedia',
  '自定义 / 中转': 'Kustom / proksi',
  '协议': 'Protokol',
  '对话模型': 'Model percakapan',
  '只存在你浏览器': 'hanya di browser Anda',
  '生图服务商': 'Penyedia gambar',
  '生图模型': 'Model gambar',
  '保存并使用': 'Simpan dan pakai',

  '取消': 'Batal',
  '笔': 'Pena',
  '橡皮': 'Penghapus',
  '撤销': 'Urungkan',
  '重做': 'Ulangi',
  '笔迹出不了这一格；iPad 支持压感，笔在画时手指不会误触。':
    'Goresan tidak bisa keluar dari panel ini; tekanan Apple Pencil didukung.',

  '已复制': 'Disalin',
  '已保存': 'Disimpan',
  '已导出': 'Diekspor',
  '已载入': 'Dimuat',
  '未命名': 'Tanpa nama',
};

/* ------------------------------------------------------------------ *
 * 术语表（数据层的词）：26 戏路 / 22 镜头 / 81 模板标签
 * 这些是 /api/meta 和模板库里显示的内容，翻掉它们整个界面才读得顺。
 * ------------------------------------------------------------------ */
Object.assign(EN, {
  // 戏路
  '战斗动作': 'Combat', '爆发必杀': 'Finisher', '追逐逃跑': 'Chase', '情绪爆发': 'Outburst',
  '对话交流': 'Dialogue', '反转揭示': 'Reveal', '悬疑紧张': 'Suspense', '恐怖惊悚': 'Horror',
  '恋爱心动': 'Romance', '搞笑吐槽': 'Gag', '回忆内心': 'Flashback', '时间蒙太奇': 'Montage',
  '静默留白': 'Silence', '日常校园': 'Slice of life', '对峙高潮': 'Standoff', '场景风光': 'Scenery',
  '竞技比赛': 'Sports', '美食料理': 'Food', '战争群战': 'War', '审讯辩论': 'Interrogation',
  '职场商战': 'Corporate', '医疗急救': 'Medical', '法术异能': 'Supernatural', '灾难末日': 'Disaster',
  '调查推理': 'Investigation', '旅途探索': 'Journey',
  // 镜头
  '场景建立': 'Establishing', '横长全景': 'Wide panorama', '全景': 'Wide shot', '全身': 'Full body',
  '群像': 'Group', '中景': 'Medium shot', '双人': 'Two-shot', '近景': 'Close shot',
  '面部特写': 'Face close-up', '眼部大特写': 'Eye extreme close-up', '手部特写': 'Hand close-up',
  '物件特写': 'Object close-up', '动作格': 'Action panel', '冲击大格': 'Impact panel',
  '反应小格': 'Reaction panel', '内心空镜': 'Inner empty shot', '俯视': 'High angle', '仰视': 'Low angle',
  '背影': 'Back view', '剪影': 'Silhouette', '插入格': 'Insert panel',
  // 模板标签
  '多格': 'Many panels', '双栏': 'Two columns', '三段落': 'Three tiers', '对称': 'Symmetric',
  '页漫': 'Page manga', '通用': 'Universal', '对话': 'Dialogue', '四格': 'Yonkoma', '网格': 'Grid',
  '小格': 'Small panels', '蒙太奇': 'Montage', '密恐': 'Dense', '大格': 'Large panel', '越界': 'Bleed',
  '留白': 'Whitespace', '插图': 'Illustration', '斜切': 'Diagonal', '二格': 'Two panels',
  '动势': 'Motion', '竖切': 'Vertical cut', '叠盖': 'Overlap', '特写': 'Close-up', '横向': 'Horizontal',
  '条漫': 'Webtoon', '竖向': 'Vertical', '节奏': 'Pacing', '速写': 'Sketch', '对峙': 'Standoff',
  '三格': 'Three panels', '不对称': 'Asymmetric', '并置': 'Juxtapose', '电影感': 'Cinematic',
  '日常': 'Daily', '变形': 'Distorted', '搞笑': 'Comedy', '少年': 'Shonen', '冲击': 'Impact',
  '速度线': 'Speed lines', '跨页': 'Spread', '少女': 'Shojo', '柔和': 'Soft', '无框': 'Borderless',
  '回忆': 'Flashback', '青年': 'Seinen', '堆叠': 'Stacked', '恐怖': 'Horror', '暗部': 'Shadow',
  '悬疑': 'Mystery', '反应格': 'Reaction', '节奏快': 'Fast pacing', '剪辑': 'Cut', '推镜': 'Push-in',
  '打击': 'Hit', '静默': 'Silent', '动作': 'Action', '快节奏': 'Quick pace', '悬念': 'Suspense',
  '长条': 'Strip', '叙事完整': 'Full narrative', '长镜头': 'Long take', '恋爱': 'Romance',
  '反转': 'Twist', '国风': 'Chinese style', '武侠': 'Wuxia', '仙侠': 'Xianxia', '宫斗': 'Palace drama',
  '都市': 'Urban', '玄幻': 'Fantasy', '彩漫': 'Full color', '大片感': 'Epic', '氛围': 'Mood',
  '情绪': 'Emotion', '惊悚': 'Thriller', '截断': 'Cropped', '连载': 'Serialized', '转场': 'Transition',
  // 其他界面
  '复制提示词': 'Copy prompt', '复制中文提示词': 'Copy ZH prompt', '复制形状词': 'Copy shape',
  '复制中文形状词': 'Copy ZH shape', '填入选中格': 'Fill selected panel', '还没写': 'empty',
  '通用镜头': 'Generic shot', '斜切格': 'Diagonal panel', '竖长格': 'Tall panel',
  '常规格': 'Regular panel', '横幅格': 'Banner panel', '交代关系': 'Context',
  '戏路': 'genres', '关键词': 'keywords', '节拍': 'beats', '场景族': 'scene families', '基调': 'tones',
  '戏路 ·': 'genres ·', '关键词 ·': 'keywords ·', '节拍 ·': 'beats ·', '场景族 ·': 'scenes ·', '基调 ·': 'tones ·',
  // 顶栏状态 / 导航 / 阅读顺序
  '静态态': 'Static',
  '离线可用': 'Offline ready',
  'AI 接入说明': 'AI setup',
  '全部模板一览': 'All templates',
  '阅读顺序': 'Reading order',
  '填你自己的模型 API：AI 会在规则筛出的合法版式里': 'Plug in your own model API: from the layouts the rules allow, AI will',
  '自己挑一套并逐格排戏': 'pick one and direct panel by panel',
  '（画面内容＋台词）。Key 只存在本机浏览器与本地服务之间，不写盘、不外传。':
    ' (visual content + dialogue). Your key never leaves this browser and your local service — never written to disk, never shared.',
  '未配置 · 规则路仍然可用': 'Not set · rules still work',
  '例：18岁剑客，黑短发，左眉有疤，深色高领外套，银色长刀':
    'e.g. 18-year-old swordsman, short black hair, scar over the left eyebrow, dark high-collar coat, silver longsword',
  '（AI 路需你填 Key，或设 LLM_API_KEY）': ' (AI needs a key, or set LLM_API_KEY)',
  // AI 状态行（JS 动态写入，含变量，用整句/正则）
  '就绪': 'Ready',
  '待填 Key': 'Key needed',
  '规则路照常可用': 'rules always work',
  '规则路仍然可用': 'rules still work',
  '默认模型': 'default model',
  '浏览器直连': 'Browser direct',
  'Key 只在你这台机器上': 'key stays on this machine',
  '静态版也能用 AI：在上面填自己的 Key（只在浏览器里，不上传）。规则路不用 Key，随时可用':
    'AI works in the static build too: enter your own key above (kept in this browser, never uploaded). Rules need no key and always work.',
  // 「怎么用」引导卡
  '怎么用（30 秒）': 'How to use (30 seconds)',
  '在「分镜模板库」选一套版式（或先写剧情，让引擎替你挑）。':
    'Pick a layout in the template library — or write the plot first and let the engine choose.',
  '点格子 → 选图；或把一批图': 'Click a panel → pick an image; or drop a batch of images',
  '直接拖进画布': 'straight onto the canvas',
  '，按阅读顺序自动填。': ' and they fill in reading order.',
  '拖图可调位置，Alt+滚轮缩放；Ctrl+V 粘贴到选中格。':
    'Drag an image to reposition it, Alt+wheel to zoom, Ctrl+V pastes into the selected panel.',
  '「分镜表」拿每格景别＋生图提示词；「导出」出 PNG/SVG。':
    'The sheet gives you each panel\'s shot size and image prompt; Export writes PNG/SVG.',
  '换模板时图片会按阅读顺序跟着搬家，方便横向对比版式。':
    'Images follow the reading order when you switch templates, so layouts are easy to compare.',
  '隐私：': 'Privacy: ',
  '图片全程在你浏览器里处理（FileReader → SVG → canvas），':
    'images are processed entirely in your browser (FileReader → SVG → canvas), ',
  '不上传、不落盘': 'never uploaded, never written to disk',
  '；关掉标签页就清空。只有剧情文字会发给你自己配置的模型。':
    '; closing the tab clears everything. Only your plot text goes to the model you configured.',
  '启用的角色会自动进提示词，参考图也会发给支持参考的模型。导出的 JSON 里带着参考图，队友导入就能用同一批人。':
    'Enabled characters are added to prompts automatically and references are sent to models that support them. The exported JSON carries the references, so teammates import and get the same cast.',
  // 画布/编辑页提示
  '静态版': 'Static build',
  '先在「分镜模板库」选一套版式，或做一次': 'First pick a layout in the template library, or run a',
  '剧情匹配': 'plot match',
  '点击格子选图 · 拖图到格子 · 批量拖入自动按顺序填充 · Ctrl+V 粘贴':
    'Click a panel to pick an image · drag images onto panels · drop a batch to fill in order · Ctrl+V pastes',
  '（未填，写剧情或让 AI 排戏）': '(empty — write the plot or let AI direct)',
  '（无）': '(none)',
  '空': 'Empty',
  '双方位置与距离': 'Positions and distance',
  '避免': 'Avoid',
  '已自动放在生图提示词': 'already placed at the start of the image prompt',
  '最前面': 'start',
  '；用别的工具出图时也可单独复制。常规格：按景别正常构图': '; you can also copy it separately when using other tools. Regular panel: compose by shot size',
  // 导出面板
  '画幅比': 'Aspect ratio',
  // 页面画幅 / 导出尺寸
  '页面画幅': 'Page format',
  '跟随模板': 'Follow template',
  'A4 竖 · 1:1.41': 'A4 portrait · 1:1.41',
  '9:16 条漫': '9:16 webtoon',
  '16:9 横版': '16:9 landscape',
  '1:1 方形': '1:1 square',
  '1:2 竖长': '1:2 tall',
  '自定义…': 'Custom…',
  '页宽 px': 'Width px', '页高 px': 'Height px',
  '等比留白（不拉伸格子）': 'Fit with margins (no stretch)',
  '应用到这一页': 'Apply to this page',
  '恢复模板画幅': 'Reset to template format',
  '页面尺寸': 'Page size',
  '宽高比': 'Aspect',
  '导出后': 'Exported',
  '长边': 'Long edge',
  '（模板坐标）': '(template units)',
  '拉伸铺满': 'Stretch to fill',
  '模板原样': 'Template default',
  '点「应用到这一页」生效': 'Press "Apply to this page" to apply',
  '还没载入模板': 'No template loaded yet',
  '页漫（A4/B5）': 'Page (A4/B5)',
  '16:9 横版 / 跨页': '16:9 landscape / spread',
  '长条滚动': 'Long scroll',
  '整页占比': 'Share of page',
  '导出像素': 'Export pixels',
  '建议出图': 'Suggested size',
  '输出尺寸': 'Output size',
  '格数 / 已填': 'Panels / filled',
  '画风': 'Art style',
  'PNG 由浏览器本地栅格化，图片以原始分辨率嵌入；导出前建议把「镂空」关掉。':
    'PNG is rasterised locally by the browser with images at full resolution — turn "Hollow" off before exporting.',
  '关掉 AI 后，左栏的 AI 面板、每格的生图按钮和候选图会一起收起来；想用随时打开。':
    'With AI off, the AI panel, per-panel generate buttons and candidate strip are hidden together; turn it back on anytime.',
  '硅基流动 SiliconFlow': 'SiliconFlow',
  '删除气泡': 'Delete bubble',
  '当前：填满裁切': 'Now: cover (cropped)',
  '当前：完整显示': 'Now: contain (whole image)',
  '视图': 'View',
  '格号开关': 'Panel numbers',
  '镂空预览': 'Hollow preview',
  '快捷键表': 'Shortcut list',
  '在输入框/文本域里打字时，单键快捷键不生效（避免误触）。': 'Single-key shortcuts are disabled while typing in a field (to avoid accidents).',
  // 每格的点子/节拍名（会显示在格子上）
  '摆开架势': 'Opening stance', '近方格': 'Approach panel', '冲击瞬间': 'Impact moment',
  '受击/反应': 'Hit / reaction', '反击再起': 'Counterattack', '通用镜头': 'Generic shot',
  '右→左': 'R→L', '左→右': 'L→R', '上→下': 'T→B',
  '日式页漫': 'Japanese manga', '中式漫画': 'Chinese comic', '韩式条漫': 'Korean webtoon',
  // 模板名里的高频词段（名字是「族·变体」结构，逐段翻）
  '웹툰': 'Webtoon', '만화': 'Manhwa', '長条漫': 'Long strip', '长条漫': 'Long strip',
  '少年漫': 'Shonen', '青年漫': 'Seinen', '少女漫': 'Shojo', '竖屏': 'Vertical',
  '三栏并置': 'Three columns', '国风': 'Chinese style', '对峙': 'Standoff',
  '长条漫·竖屏': 'Long strip · vertical',
  // 气泡类型
  '椭圆对话泡': 'Round bubble', '圆角对话泡': 'Rounded bubble', '双线对话泡': 'Double-line bubble',
  '云朵思考泡': 'Thought cloud', '虚框内心泡': 'Inner monologue', '尖角喊叫泡': 'Shout balloon',
  '爆炸冲击泡': 'Burst balloon', '重描边方泡': 'Heavy box', '旁白框': 'Narration box',
  '旁白标签': 'Narration tag', '反白字幕条': 'Caption bar', '耳语波纹泡': 'Whisper wavy',
  '小旁注': 'Side note', '箭头指示泡': 'Arrow callout',
  // 常见长句
  '「绘制」会把上面这张图当底稿放进画布 —— 可以在上面描线、擦、覆盖；画完自动裁成格子形状贴回来。AI 生成的图、你自己拖进来的照片都是同一套流程。':
    'Draw puts this image into the canvas as a base layer — trace over it, erase it, paint on it; the result is clipped to the panel shape. AI images and your own photos follow the same flow.',
  '语言': 'Language',
  '生成中…': 'Generating…', '生图中…': 'Generating image…', '已复制到剪贴板': 'Copied to clipboard',
  '台词 / 旁白 / 内心独白（自动存到本机）': 'Dialogue / narration / inner voice (saved locally)',
  '粘贴一段剧情，越具体越准。例如：雨夜的屋顶上，他缓缓拔出刀；敌人从背后偷袭，他反手一刀斩断对方的刀锋，两人在积水里僵持。':
    'Paste your plot — the more specific the better. e.g. On a rainy rooftop he slowly draws his blade; an enemy strikes from behind, he spins and cuts the blade in half; they face off in the puddles.',
});

Object.assign(ID, {
  '战斗动作': 'Aksi tempur', '爆发必杀': 'Jurusan pamungkas', '追逐逃跑': 'Pengejaran',
  '情绪爆发': 'Ledakan emosi', '对话交流': 'Dialog', '反转揭示': 'Plot twist', '悬疑紧张': 'Ketegangan',
  '恐怖惊悚': 'Horor', '恋爱心动': 'Romansa', '搞笑吐槽': 'Komedi', '回忆内心': 'Kilas balik',
  '时间蒙太奇': 'Montase', '静默留白': 'Keheningan', '日常校园': 'Kehidupan sehari-hari',
  '对峙高潮': 'Konfrontasi', '场景风光': 'Pemandangan', '竞技比赛': 'Olahraga', '美食料理': 'Kuliner',
  '战争群战': 'Perang', '审讯辩论': 'Interogasi', '职场商战': 'Dunia kerja', '医疗急救': 'Medis',
  '法术异能': 'Kekuatan supranatural', '灾难末日': 'Bencana', '调查推理': 'Investigasi',
  '旅途探索': 'Perjalanan',
  '场景建立': 'Pembuka lokasi', '横长全景': 'Panorama lebar', '全景': 'Bidikan lebar',
  '全身': 'Seluruh tubuh', '群像': 'Kelompok', '中景': 'Bidikan sedang', '双人': 'Dua orang',
  '近景': 'Bidikan dekat', '面部特写': 'Close-up wajah', '眼部大特写': 'Close-up mata',
  '手部特写': 'Close-up tangan', '物件特写': 'Close-up benda', '动作格': 'Panel aksi',
  '冲击大格': 'Panel dampak', '反应小格': 'Panel reaksi', '内心空镜': 'Bidikan batin',
  '俯视': 'Dari atas', '仰视': 'Dari bawah', '背影': 'Dari belakang', '剪影': 'Siluet',
  '插入格': 'Panel sisipan',
  '多格': 'Banyak panel', '双栏': 'Dua kolom', '三段落': 'Tiga bagian', '对称': 'Simetris',
  '页漫': 'Manga halaman', '通用': 'Umum', '对话': 'Dialog', '四格': 'Yonkoma', '网格': 'Kisi',
  '小格': 'Panel kecil', '蒙太奇': 'Montase', '密恐': 'Padat', '大格': 'Panel besar',
  '越界': 'Keluar batas', '留白': 'Ruang kosong', '插图': 'Ilustrasi', '斜切': 'Diagonal',
  '二格': 'Dua panel', '动势': 'Gerakan', '竖切': 'Potongan vertikal', '叠盖': 'Tumpang tindih',
  '特写': 'Close-up', '横向': 'Horizontal', '条漫': 'Webtoon', '竖向': 'Vertikal', '节奏': 'Ritme',
  '速写': 'Sketsa', '对峙': 'Konfrontasi', '三格': 'Tiga panel', '不对称': 'Asimetris',
  '并置': 'Bersebelahan', '电影感': 'Sinematik', '日常': 'Harian', '变形': 'Terdistorsi',
  '搞笑': 'Lucu', '少年': 'Shonen', '冲击': 'Dampak', '速度线': 'Garis kecepatan',
  '跨页': 'Dua halaman', '少女': 'Shojo', '柔和': 'Lembut', '无框': 'Tanpa bingkai',
  '回忆': 'Kilas balik', '青年': 'Seinen', '堆叠': 'Bertumpuk', '恐怖': 'Horor', '暗部': 'Bayangan',
  '悬疑': 'Misteri', '反应格': 'Reaksi', '节奏快': 'Ritme cepat', '剪辑': 'Potongan',
  '推镜': 'Zoom masuk', '打击': 'Pukulan', '静默': 'Senyap', '动作': 'Aksi',
  '快节奏': 'Tempo cepat', '悬念': 'Ketegangan', '长条': 'Gulir panjang',
  '叙事完整': 'Cerita lengkap', '长镜头': 'Bidikan panjang', '恋爱': 'Romansa', '反转': 'Balikan',
  '国风': 'Gaya Tiongkok', '武侠': 'Wuxia', '仙侠': 'Xianxia', '宫斗': 'Drama istana',
  '都市': 'Perkotaan', '玄幻': 'Fantasi', '彩漫': 'Berwarna', '大片感': 'Epik', '氛围': 'Suasana',
  '情绪': 'Emosi', '惊悚': 'Thriller', '截断': 'Terpotong', '连载': 'Berseri', '转场': 'Transisi',
  '复制提示词': 'Salin prompt', '复制中文提示词': 'Salin prompt ZH', '复制形状词': 'Salin bentuk',
  '复制中文形状词': 'Salin bentuk ZH', '填入选中格': 'Isi panel terpilih', '还没写': 'kosong',
  '通用镜头': 'Bidikan umum', '斜切格': 'Panel diagonal', '竖长格': 'Panel tinggi',
  '常规格': 'Panel biasa', '横幅格': 'Panel spanduk', '交代关系': 'Konteks',
  '戏路': 'genre', '关键词': 'kata kunci', '节拍': 'ketukan', '场景族': 'keluarga adegan',
  '基调': 'nada',
  '戏路 ·': 'genre ·', '关键词 ·': 'kata kunci ·', '节拍 ·': 'ketukan ·', '场景族 ·': 'adegan ·', '基调 ·': 'nada ·',
  '静态态': 'Statis',
  '离线可用': 'Bisa offline',
  'AI 接入说明': 'Panduan AI',
  '全部模板一览': 'Semua template',
  '阅读顺序': 'Urutan baca',
  '填你自己的模型 API：AI 会在规则筛出的合法版式里': 'Pakai API model Anda: dari tata letak yang lolos aturan, AI akan',
  '自己挑一套并逐格排戏': 'memilih satu dan menyusun per panel',
  '（画面内容＋台词）。Key 只存在本机浏览器与本地服务之间，不写盘、不外传。':
    ' (isi gambar + dialog). API key hanya tersimpan di browser ini dan layanan lokal — tidak ditulis ke disk, tidak dikirim keluar.',
  '未配置 · 规则路仍然可用': 'Belum diatur · aturan tetap jalan',
  '例：18岁剑客，黑短发，左眉有疤，深色高领外套，银色长刀':
    'contoh: pendekar 18 tahun, rambut hitam pendek, bekas luka di alis kiri, mantel kerah tinggi gelap, pedang panjang perak',
  '（AI 路需你填 Key，或设 LLM_API_KEY）': ' (AI perlu key, atau set LLM_API_KEY)',
  '就绪': 'Siap',
  '待填 Key': 'Perlu key',
  '规则路照常可用': 'aturan selalu jalan',
  '规则路仍然可用': 'aturan tetap jalan',
  '默认模型': 'model bawaan',
  '浏览器直连': 'Langsung dari browser',
  'Key 只在你这台机器上': 'key tetap di mesin ini',
  '静态版也能用 AI：在上面填自己的 Key（只在浏览器里，不上传）。规则路不用 Key，随时可用':
    'AI juga berfungsi di versi statis: isi key Anda di atas (hanya di browser, tidak diunggah). Aturan tidak perlu key dan selalu jalan.',
  '怎么用（30 秒）': 'Cara pakai (30 detik)',
  '在「分镜模板库」选一套版式（或先写剧情，让引擎替你挑）。':
    'Pilih tata letak di perpustakaan template — atau tulis alurnya dulu dan biarkan mesin memilih.',
  '点格子 → 选图；或把一批图': 'Klik panel → pilih gambar; atau seret beberapa gambar',
  '直接拖进画布': 'langsung ke kanvas',
  '，按阅读顺序自动填。': ' dan terisi sesuai urutan baca.',
  '拖图可调位置，Alt+滚轮缩放；Ctrl+V 粘贴到选中格。':
    'Seret gambar untuk memindahkan, Alt+scroll untuk memperbesar, Ctrl+V menempel ke panel terpilih.',
  '「分镜表」拿每格景别＋生图提示词；「导出」出 PNG/SVG。':
    'Lembar panel memberi ukuran bidikan dan prompt tiap panel; Ekspor menghasilkan PNG/SVG.',
  '换模板时图片会按阅读顺序跟着搬家，方便横向对比版式。':
    'Saat berganti template, gambar ikut urutan baca sehingga mudah membandingkan tata letak.',
  '隐私：': 'Privasi: ',
  '图片全程在你浏览器里处理（FileReader → SVG → canvas），':
    'gambar diproses sepenuhnya di browser Anda (FileReader → SVG → canvas), ',
  '不上传、不落盘': 'tidak diunggah, tidak ditulis ke disk',
  '；关掉标签页就清空。只有剧情文字会发给你自己配置的模型。':
    '; menutup tab menghapus semuanya. Hanya teks alur yang dikirim ke model Anda.',
  '启用的角色会自动进提示词，参考图也会发给支持参考的模型。导出的 JSON 里带着参考图，队友导入就能用同一批人。':
    'Karakter yang aktif otomatis masuk ke prompt dan referensinya dikirim ke model yang mendukung. JSON hasil ekspor membawa referensi, jadi rekan tim bisa memakai karakter yang sama.',
  '静态版': 'Versi statis',
  '先在「分镜模板库」选一套版式，或做一次': 'Pilih tata letak di perpustakaan template, atau jalankan',
  '剧情匹配': 'pencocokan alur',
  '点击格子选图 · 拖图到格子 · 批量拖入自动按顺序填充 · Ctrl+V 粘贴':
    'Klik panel untuk memilih gambar · seret gambar ke panel · seret banyak gambar untuk mengisi berurutan · Ctrl+V menempel',
  '（未填，写剧情或让 AI 排戏）': '(kosong — tulis alurnya atau biarkan AI menyusun)',
  '（无）': '(tidak ada)',
  '空': 'Kosong',
  '双方位置与距离': 'Posisi dan jarak',
  '避免': 'Hindari',
  '已自动放在生图提示词': 'sudah diletakkan di awal prompt gambar',
  '最前面': 'awal',
  '；用别的工具出图时也可单独复制。常规格：按景别正常构图': '; bisa juga disalin saat memakai alat lain. Panel biasa: komposisi sesuai ukuran bidikan',
  '画幅比': 'Rasio aspek',
  '页面画幅': 'Format halaman',
  '跟随模板': 'Ikuti template',
  'A4 竖 · 1:1.41': 'A4 tegak · 1:1.41',
  '9:16 条漫': '9:16 webtoon',
  '16:9 横版': '16:9 lanskap',
  '1:1 方形': '1:1 persegi',
  '1:2 竖长': '1:2 tinggi',
  '自定义…': 'Kustom…',
  '页宽 px': 'Lebar px', '页高 px': 'Tinggi px',
  '等比留白（不拉伸格子）': 'Sesuai skala dengan margin (tanpa tarik)',
  '应用到这一页': 'Pakai di halaman ini',
  '恢复模板画幅': 'Kembali ke format template',
  '页面尺寸': 'Ukuran halaman',
  '宽高比': 'Rasio',
  '导出后': 'Setelah ekspor',
  '长边': 'Sisi panjang',
  '（模板坐标）': '(satuan template)',
  '拉伸铺满': 'Tarik penuh',
  '模板原样': 'Bawaan template',
  '点「应用到这一页」生效': 'Tekan "Pakai di halaman ini" untuk menerapkan',
  '还没载入模板': 'Template belum dimuat',
  '页漫（A4/B5）': 'Halaman (A4/B5)',
  '16:9 横版 / 跨页': '16:9 lanskap / dua halaman',
  '长条滚动': 'Gulir panjang',
  '整页占比': 'Porsi halaman',
  '导出像素': 'Piksel ekspor',
  '建议出图': 'Ukuran saran',
  '输出尺寸': 'Ukuran keluaran',
  '格数 / 已填': 'Panel / terisi',
  '画风': 'Gaya gambar',
  'PNG 由浏览器本地栅格化，图片以原始分辨率嵌入；导出前建议把「镂空」关掉。':
    'PNG dirasterisasi lokal oleh browser dengan gambar resolusi penuh — matikan "Kosong" sebelum mengekspor.',
  '关掉 AI 后，左栏的 AI 面板、每格的生图按钮和候选图会一起收起来；想用随时打开。':
    'Dengan AI nonaktif, panel AI, tombol buat gambar, dan kandidat ikut disembunyikan; bisa diaktifkan lagi kapan saja.',
  '硅基流动 SiliconFlow': 'SiliconFlow',
  '删除气泡': 'Hapus balon',
  '当前：填满裁切': 'Sekarang: penuh (dipotong)',
  '当前：完整显示': 'Sekarang: utuh',
  '视图': 'Tampilan',
  '格号开关': 'Nomor panel',
  '镂空预览': 'Pratinjau kosong',
  '快捷键表': 'Daftar pintasan',
  '在输入框/文本域里打字时，单键快捷键不生效（避免误触）。': 'Pintasan satu tombol nonaktif saat mengetik di kolom input.',
  '摆开架势': 'Sikap pembuka', '近方格': 'Panel mendekat', '冲击瞬间': 'Momen dampak',
  '受击/反应': 'Terkena / reaksi', '反击再起': 'Serangan balik', '通用镜头': 'Bidikan umum',
  '右→左': 'K→Kr', '左→右': 'Kr→K', '上→下': 'A→B',
  '日式页漫': 'Manga Jepang', '中式漫画': 'Komik Tiongkok', '韩式条漫': 'Webtoon Korea',
  '웹툰': 'Webtoon', '만화': 'Manhwa', '长条漫': 'Strip panjang',
  '少年漫': 'Shonen', '青年漫': 'Seinen', '少女漫': 'Shojo', '竖屏': 'Vertikal',
  '三栏并置': 'Tiga kolom', '国风': 'Gaya Tiongkok', '对峙': 'Konfrontasi',
  '椭圆对话泡': 'Balon bulat', '圆角对话泡': 'Balon sudut bulat', '双线对话泡': 'Balon dua garis',
  '云朵思考泡': 'Awan pikiran', '虚框内心泡': 'Monolog batin', '尖角喊叫泡': 'Balon teriakan',
  '爆炸冲击泡': 'Balon ledakan', '重描边方泡': 'Kotak tebal', '旁白框': 'Kotak narasi',
  '旁白标签': 'Label narasi', '反白字幕条': 'Bilah teks', '耳语波纹泡': 'Balon bisikan',
  '小旁注': 'Catatan samping', '箭头指示泡': 'Balon panah',
  '「绘制」会把上面这张图当底稿放进画布 —— 可以在上面描线、擦、覆盖；画完自动裁成格子形状贴回来。AI 生成的图、你自己拖进来的照片都是同一套流程。':
    'Tombol Gambar menaruh foto ini di kanvas sebagai lapisan dasar — bisa ditimpa, dihapus, atau dicat; hasilnya dipotong sesuai bentuk panel. Gambar AI dan foto Anda memakai alur yang sama.',
  '粘贴一段剧情，越具体越准。例如：雨夜的屋顶上，他缓缓拔出刀；敌人从背后偷袭，他反手一刀斩断对方的刀锋，两人在积水里僵持。':
    'Tempel alur cerita — makin detail makin akurat. Contoh: Di atap saat hujan malam, ia perlahan mencabut pedangnya; musuh menyerang dari belakang, ia berputar dan memotong pedang itu; keduanya berhadapan di genangan air.',
  '生成中…': 'Membuat…', '生图中…': 'Membuat gambar…', '已复制到剪贴板': 'Disalin ke papan klip',
  '台词 / 旁白 / 内心独白（自动存到本机）': 'Dialog / narasi / suara hati (disimpan lokal)',
});

/* 无空格的「4格」这类也要能翻 */

/** 带数字的动态文案：正则 → 替换模板 */
const EN_PATTERNS = [
  [/^(\d+) 套模板 · (\d+) 种格型$/, '$1 templates · $2 panel types'],
  [/^(\d+) 套$/, '$1 templates'],
  [/^(\d+)套$/, '$1 templates'],
  [/^(\d+) 格$/, '$1 panels'],
  [/^(\d+)格$/, '$1 panels'],
  [/^(\d+) 张候选$/, '$1 candidates'],
  [/^第 (\d+) 页$/, 'Page $1'],
  [/^导出中 (\d+)\/(\d+)…$/, 'Exporting $1/$2…'],
  [/^绘制第 (\d+) 格$/, 'Draw panel $1'],
  [/^第 (\d+) 格$/, 'Panel $1'],
  [/^已填入 (\d+) 格$/, 'Filled $1 panels'],
  [/^已恢复上次的 (\d+) 页草稿$/, 'Restored $1 draft pages'],
  [/^已存这一格（(\d+) 笔）$/, 'Saved this panel ($1 strokes)'],
  [/^(.+) ｜ (.+)$/, '$1 | $2'],
  [/^本地规则引擎 v([\d.]+)：/, 'Local rule engine v$1:'],
  [/^(\d+)格 · (.+) · 左→右 · 上→下$/, '$1 panels · $2 · L→R · T→B'],
  [/^(\d+)格 · (.+) · 右→左 · 上→下$/, '$1 panels · $2 · R→L · T→B'],
  // 模板名里的「（8 格）」「2×2 四格」这类
  [/（(\d+) ?格）$/, ' ($1 panels)'],
  [/^(\d+)×(\d+) (\d+)格$/, '$1×$2 · $3 panels'],
  [/^(\d+)格$/, '$1 panels'],
  [/^编辑第 (\d+) 格$/, 'Edit panel $1'],
  [/^导出中 (\d+)\/(\d+)…$/, 'Exporting $1/$2…'],
  [/^浏览器直连 · (.+) · (.+)（Key 只在你这台机器上）$/, 'Browser direct · $1 · $2 (key stays on this machine)'],
];
const ID_PATTERNS = [
  [/^(\d+) 套模板 · (\d+) 种格型$/, '$1 template · $2 jenis panel'],
  [/^(\d+) 套$/, '$1 template'],
  [/^(\d+) 格$/, '$1 panel'],
  [/^(\d+)格$/, '$1 panel'],
  [/^(\d+) 张候选$/, '$1 kandidat'],
  [/^第 (\d+) 页$/, 'Halaman $1'],
  [/^导出中 (\d+)\/(\d+)…$/, 'Mengekspor $1/$2…'],
  [/^绘制第 (\d+) 格$/, 'Gambar panel $1'],
  [/^第 (\d+) 格$/, 'Panel $1'],
  [/^(\d+)格$/, '$1 panel'],
  [/^(\d+)套$/, '$1 template'],
  [/^已填入 (\d+) 格$/, '$1 panel terisi'],
  [/^已恢复上次的 (\d+) 页草稿$/, 'Draf $1 halaman dipulihkan'],
  [/^已存这一格（(\d+) 笔）$/, 'Panel disimpan ($1 goresan)'],
  [/^(.+) ｜ (.+)$/, '$1 | $2'],
  [/^本地规则引擎 v([\d.]+)：/, 'Mesin aturan lokal v$1:'],
  [/^(\d+)格 · (.+) · 左→右 · 上→下$/, '$1 panel · $2 · K→Kr · A→B'],
  [/^(\d+)格 · (.+) · 右→左 · 上→下$/, '$1 panel · $2 · Kr→K · A→B'],
  [/（(\d+) ?格）$/, ' ($1 panel)'],
  [/^(\d+)×(\d+) (\d+)格$/, '$1×$2 · $3 panel'],
  [/^(\d+)格$/, '$1 panel'],
  [/^编辑第 (\d+) 格$/, 'Edit panel $1'],
  [/^浏览器直连 · (.+) · (.+)（Key 只在你这台机器上）$/, 'Langsung dari browser · $1 · $2 (key tetap di mesin ini)'],
];

const DICTS = { en: EN, id: ID };
const PATTERNS = { en: EN_PATTERNS, id: ID_PATTERNS };

const TITLE = {
  en: 'PanelForge · Manga storyboard template library',
  id: 'PanelForge · Perpustakaan template papan cerita',
};

/** 把一条原文翻成目标语言；翻不了就原样返回 */
export function translate(text, lang, depth = 0) {
  if (!text || lang === 'zh') return text;
  const dict = DICTS[lang];
  if (!dict) return text;
  const raw = text.trim();
  if (!raw) return text;
  if (dict[raw]) return text.replace(raw, dict[raw]);
  for (const [re, rep] of PATTERNS[lang] || []) {
    if (re.test(raw)) return text.replace(raw, raw.replace(re, rep));
  }
  // 「8 格 · A4 · 右→左 · 上→下 · 日式页漫」这类**多段信息行**：
  // 按「 · 」切开逐段翻再拼回去。必须排在 sep/tail 之前，否则会被 tail 提前截断
  // （tail 只会翻最后一段，结果就变成半中半英）。
  if (depth < 3 && /·/.test(raw)) {
    const parts = raw.split(/\s*·\s*/);
    if (parts.length > 1) {
      const done = parts.map((p) => translate(p, lang, depth + 1).trim());
      if (done.some((p, i) => p !== parts[i].trim())) return text.replace(raw, done.join(' · '));
    }
  }
  // 「阅读顺序：右→左」这种 标签：值
  if (depth < 3) {
    const kv = raw.match(/^([^：:|]{1,16})[：:]\s*(.+)$/);
    if (kv) {
      const label = translate(kv[1], lang, depth + 1).trim();
      const value = translate(kv[2], lang, depth + 1).trim();
      if (label !== kv[1].trim() || value !== kv[2].trim()) {
        return text.replace(raw, `${label}: ${value}`);
      }
    }
  }
  // 「· 交代关系」「| 旁白」这种把分隔符和正文放在同一个文本节点里的写法：
  // 拆出分隔符，翻剩下的部分再拼回去
  const sep = raw.match(/^([·|/、,，:：]\s*)(.+)$/);
  if (sep) {
    const inner = dict[sep[2].trim()];
    if (inner) return text.replace(raw, sep[1] + inner);
  }
  // 「wide shot· 交接关系」这种前半段已经是英文、只有尾巴是中文的
  const tail = raw.match(/^(.*[·|]\s*)(.+)$/);
  if (tail) {
    const inner = dict[tail[2].trim()];
    if (inner) return text.replace(raw, tail[1] + inner);
  }
  return text;
}

/* ------------------------------------------------------------------ *
 * DOM 层：记住原文 → 按语言重写
 * ------------------------------------------------------------------ */
const originals = new WeakMap();   // textNode → 原文
const attrOriginals = new WeakMap(); // element → { attr: 原文 }
const TEXT_ATTRS = ['placeholder', 'title', 'aria-label'];
let current = 'zh';
let installed = false;
let mo = null;

function walkText(root, fn) {
  if (!root) return;
  if (root.nodeType === Node.TEXT_NODE) { fn(root); return; }
  if (root.nodeType !== Node.ELEMENT_NODE) return;
  // 不翻代码块 / 已经是我们自己注入的内容
  if (/^(SCRIPT|STYLE|SVG|CODE|PRE)$/.test(root.tagName || '')) return;
  const doc = root.ownerDocument || document;
  const w = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
  const list = [];
  while (w.nextNode()) list.push(w.currentNode);
  for (const n of list) {
    const p = n.parentElement;
    if (p && /^(SCRIPT|STYLE|SVG|CODE|PRE|TEXTAREA)$/.test(p.tagName)) continue;
    fn(n);
  }
}

function applyTextNodes(root) {
  walkText(root, (node) => {
    if (!originals.has(node)) originals.set(node, node.nodeValue);
    const src = originals.get(node);
    const next = translate(src, current);
    if (node.nodeValue !== next) node.nodeValue = next;
  });
}

function applyAttrs(root) {
  const els = root.nodeType === Node.ELEMENT_NODE ? [root, ...root.querySelectorAll('*')] : [];
  for (const el of els) {
    for (const attr of TEXT_ATTRS) {
      if (!el.hasAttribute(attr)) continue;
      let store = attrOriginals.get(el);
      if (!store) { store = {}; attrOriginals.set(el, store); }
      if (!(attr in store)) store[attr] = el.getAttribute(attr);
      const next = translate(store[attr], current);
      if (el.getAttribute(attr) !== next) el.setAttribute(attr, next);
    }
  }
}

/** 把整页（或某个子树）翻译成当前语言 */
export function retranslate(root = document.body) {
  applyTextNodes(root);
  applyAttrs(root);
}

function startObserver() {
  if (mo || typeof MutationObserver === 'undefined') return;
  let queued = false;
  mo = new MutationObserver(() => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      retranslate(document.body);
    });
  });
  mo.observe(document.body, { childList: true, subtree: true, characterData: true });
}

export function getLang() { return current; }

export function setLang(lang) {
  current = LANGS.some((l) => l.id === lang) ? lang : 'zh';
  const root = document.documentElement;
  root.lang = current === 'id' ? 'id' : (current === 'en' ? 'en' : 'zh-CN');
  root.dataset.lang = current;
  if (current !== 'zh' && TITLE[current]) document.title = TITLE[current];
  if (installed) retranslate(document.body);
  return current;
}

/** 装上：只装一次；返回卸载函数（测试用） */
export function installI18n(initial = 'zh') {
  installed = true;
  setLang(initial);
  startObserver();
  retranslate(document.body);
  return () => { mo?.disconnect(); mo = null; installed = false; };
}

/** 覆盖率统计：当前语言下，还有多少条中文没翻（调试用） */
export function stats(root = document.body) {
  let total = 0, hit = 0;
  walkText(root, (node) => {
    const src = originals.get(node) ?? node.nodeValue;
    if (!/[\u4e00-\u9fa5]/.test(src)) return;
    total++;
    if (translate(src, current) !== src) hit++;
  });
  return { lang: current, chinese: total, translated: hit, missing: total - hit };
}
