# html2pdf.js

- Version: 0.14.0
- Source: `https://www.npmjs.com/package/html2pdf.js/v/0.14.0`
- Bundle: `html2pdf.bundle.js` —— **本仓库自建**，不是上游 dist 产物
- Build: `node tools/build-vendor.mjs`（升级版本时重跑；产物要提交进库）
- Check: `node tools/build-vendor.mjs --check`（pack.ps1 / pack-crx.ps1 打包前自动跑）
- License: MIT，见 `html2pdf.bundle.js.LICENSE.txt`；各依赖的 @license 声明汇总在产物末尾

## 为什么不直接用上游的 dist/html2pdf.bundle.min.js

2026-09 Chrome Web Store 以两条理由拒审，都指向那个文件：

1. **Blue Argon｜MV3 含远程托管代码** —— jsPDF 的 `output('pdfobjectnewwindow')`
   会从 cdnjs 拉 `pdfobject.min.js` 注入新窗口。我们只调 `output('arraybuffer')`，
   那条分支永远走不到，但静态审核只看包里有没有这段代码。
2. **Red Titanium｜含混淆代码** —— 上游 dist 是 webpack 压缩产物，且捆了整棵
   core-js polyfill 树（审核截取的 `ActiveXObject` / `NullProtoObject` 片段就是它）。

`tools/build-vendor.mjs` 因此从 npm 源码重新打包：esbuild 不压缩输出（可读），
切掉 `pdfobjectnewwindow` / `pdfjsnewwindow` 两个会引外部资源的 output 分支，
并把 jsPDF SVG 插件动态 `import('canvg')` 的 canvg 换成空 stub —— core-js 随之整棵消失。

PDF/PNG 渲染路径不碰 SVG 插件，所以 canvg 缺席不影响功能；真调到 `addSvgAsImage()`
会抛明确错误而不是静默失败。Electron 端的"导出 PDF"走 Chromium 原生 `printToPDF`，
只有 PNG 长图复用这个 bundle。
