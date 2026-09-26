# cyc-012 · 对话地层学 · 关系考古发掘系统

纯前端关系考古挖掘可视化系统。用户导入微信/QQ/短信聊天记录文件，系统以考古挖掘的隐喻将时间序列深度切片为五层地质构造，分层展示关系温度变化、话题演变、情感词汇沉积，并可出土对话化石及生成完整《关系考古报告》。

## 架构说明（分层架构：核心层 / 端口层 / 适配器层）

- `src/core`：领域模型（`ChatMessage`、`StrataLayer`、`ArchaeologyReport`、`FossilArtifact`）与地层沉积分析引擎，纯算法与领域规则，无外部依赖。
- `src/ports`：端口层定义契约（`ChatParserPort` 聊天解析端口、`ArchaeologyPort` 发掘分析端口）。
- `src/adapters`：适配器层（通用微信/QQ/短信文本解析适配器、内置三大历史遗址标本适配器、考古分析引擎适配器）。
- `src/ui`：原生 CSS 视觉呈现层，包含地层岩芯柱交互、温度计、情感光谱条、文物展示抽屉与报告弹窗。

## 本地运行

```bash
npm install
npm run dev
```

## 构建验证

```bash
npm run build
```

## Docker 容器化部署

```bash
docker compose up --build
```
访问：`http://localhost:8012`
