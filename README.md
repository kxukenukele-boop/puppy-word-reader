# 小狗单词故事阅读器

一个不需要后端的静态 Web App / PWA，适合手机和电脑阅读 `.docx` 单词故事。

## 已实现

- 打开 `.docx` Word 文件并转换为网页阅读。
- 保留 Word 中显式加粗的内容；加粗词可直接点击查词。
- 长按/拖选一个英文单词后自动弹出查词卡。
- 每篇文档保存在当前浏览器的 IndexedDB；再次打开回到上次阅读位置。
- 字号调整、浅色/深色/跟随系统主题。
- 支持一次性导入 ECDICT `ecdict.csv`，之后中文释义、音标、词性和词形原形均从本机 IndexedDB 查询。
- 朗读使用浏览器 `speechSynthesis`，不调用第三方语音 API；能否完全断网发音取决于系统是否已安装本地英语语音。
- PWA：部署到 HTTPS（例如 GitHub Pages）后可安装；Service Worker 会缓存阅读器和解析组件供后续离线使用。

## 最推荐的使用方式：GitHub Pages

1. 新建一个 GitHub repository，例如 `puppy-word-reader`。
2. 把本文件夹内的所有文件原样上传到仓库根目录。
3. GitHub → **Settings → Pages**。
4. Source 选择 **Deploy from a branch**，分支选 `main`，目录选 `/ (root)`。
5. 等 GitHub 给出网页地址后，用手机和电脑都打开一次。
6. 手机上可以用浏览器“添加到主屏幕 / 安装应用”。第一次联网打开成功后，应用本体会被缓存，之后可以离线启动。

> 直接双击 `index.html` 也可能可以阅读，但 `file://` 模式无法注册 Service Worker，而且不同浏览器对本地 IndexedDB 的行为不一致。因此更推荐 GitHub Pages。

## 离线词典

推荐 ECDICT：<https://github.com/skywind3000/ECDICT>

仓库中的 `ecdict.csv` 包含 `word`, `phonetic`, `translation`, `pos`, `exchange` 等字段。阅读器只保存查词需要的字段，不上传文件。

操作：

1. 下载 ECDICT 的 `ecdict.csv` 到手机或电脑。
2. 阅读器首页 → **离线词典** → **选择 ecdict.csv**。
3. 等待导入完成。大文件在手机上会比较慢，但只需要做一次。
4. 以后选词即可断网查中文和音标。

## 离线发音

应用使用系统自带的 Web Speech / Speech Synthesis。它本身不需要我方服务器，但某些设备的语音可能是网络语音。

- Windows：在系统语言/语音设置中安装 English (United States) 的本地语音。
- Android：在“文字转语音输出 / Speech Services”里下载英语语音数据（具体入口依手机系统不同）。
- iPhone / iPad：系统语音通常由 iOS 管理，可在辅助功能/朗读相关设置中下载增强语音。

应用优先选择 `localService=true` 的英语语音。

## 隐私

文档 HTML、阅读位置、设置和词典均保存在当前浏览器。本项目没有服务器代码，也没有上传文档的逻辑。

## 第三方库

浏览器第一次加载时会从 jsDelivr 获取并由 Service Worker 缓存：

- Mammoth 1.12.2 — `.docx` → HTML
- DOMPurify 3.4.15 — 清理转换后的 HTML
- Papa Parse 5.7.0 — 分块解析本地 ECDICT CSV

部署者如希望“第一次启动也完全不访问 CDN”，可将这三个浏览器脚本下载到 `vendor/` 并把 `index.html` 与 `sw.js` 的 URL 改成本地相对路径。

## 数据说明

ECDICT 项目代码采用开源许可，但词典内容由多来源整理。个人学习使用通常最简单；若将来把本应用做成公开商业产品，应单独核实词典数据的授权和来源。
