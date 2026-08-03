将你的机床知识库文件（PDF / Word / TXT / Markdown 等）放在此目录下。

然后运行构建脚本：

  npm run build-kb

脚本会自动扫描此目录下所有支持的文件，解析、分块、向量化并写入 LibSQL 向量库。

支持格式：
- .pdf  — PDF 文档
- .docx / .doc — Word 文档
- .txt  — 纯文本
- .md   — Markdown
- .json / .csv / .html / .xml / .yaml — 其他文本格式

扩展格式：
在 src/lib/document-parser.ts 中调用 registerParser('.xlsx', yourParserFn) 即可添加新格式。
