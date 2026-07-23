# 文件上传修复方案

## 问题总览

| # | 优先级 | 位置 | 问题 | 风险 |
|---|--------|------|------|------|
| 1 | P0 | `api/chat/route.ts:64` | 缺少服务端校验（无大小/数量/base64检查） | DoS、内存溢出 |
| 2 | P1 | `file-utils.ts:14-15` | 未知扩展名静默伪装为 "word" | 解析必然失败但无提示 |
| 3 | P1 | `file-upload-menu.tsx:25-26` | 超限文件静默丢弃无反馈 | 用户困惑 |
| 4 | P1 | `file-utils.ts:5` vs `route.ts:24` | `SerializedFile.type` 客户端缺少 "image" 类型 | 类型不一致、image 特性未贯通 |
| 5 | P2 | `file-utils.ts:46-49` | 序列化失败静默跳过 | 用户不知道文件传失败了 |
| 6 | P2 | `agent-chat-panel.tsx` | 缺少拖拽/粘贴上传 | UX 缺失 |
| 7 | P2 | `file-utils.ts:47` | `console.error` 在 client module 中使用 | 项目规范建议用结构化日志，但 client 端无 logger |
| 8 | P3 | `file-upload-menu.tsx:36-64` | `<input>` 缺少 `multiple` 属性 | 一次只能选一个文件 |
| 9 | P3 | `agent-chat-panel.tsx:100` | `filesRef.current = []` 清空的竞态风险 | 快速连续发送可能丢文件 |

> **说明**: 问题 #7 的 `file-utils.ts` 是 `"use client"` 模块，浏览器端无 `lib/logger.ts` 所需的 `process.stdout`，因此 `console.error` 在此场景下可接受。不做修复。

---

## P0: 服务端校验（`app/api/chat/route.ts`）

### 当前状态

```typescript
// line 64 — 无任何校验
const uploadedFiles: SerializedFile[] = Array.isArray(body.files) ? body.files : [];
const attachments = collectRawAttachments(uploadedFiles);
```

### 修复方案

在 `POST` handler 的 body 解析之后、agent 创建之前，插入验证函数：

```typescript
// --- 新增常量 (放入 lib/constants.ts) ---
export const MAX_FILE_COUNT = 10;
export const MAX_SINGLE_FILE_SIZE_MB = 20;  // 比前端松以保证后端兜底
export const ALLOWED_FILE_TYPES = ["pdf", "word", "excel", "image"] as const;

// --- 新增验证函数 (放入 api/chat/route.ts) ---
interface UploadError {
  index: number;
  name: string;
  reason: string;
}

function validateFiles(files: SerializedFile[]): {
  valid: SerializedFile[];
  errors: UploadError[];
} {
  const errors: UploadError[] = [];

  if (files.length > MAX_FILE_COUNT) {
    return {
      valid: [],
      errors: [{ index: -1, name: "", reason: `文件数量超过上限 (${MAX_FILE_COUNT})` }],
    };
  }

  const valid: SerializedFile[] = [];
  for (let i = 0; i < files.length; i++) {
    const f = files[i];

    // 类型白名单
    if (!ALLOWED_FILE_TYPES.includes(f.type as typeof ALLOWED_FILE_TYPES[number])) {
      errors.push({ index: i, name: f.name, reason: `不支持的文件类型: ${f.type}` });
      continue;
    }

    // base64 有效性
    if (!f.data || typeof f.data !== "string" || f.data.length === 0) {
      errors.push({ index: i, name: f.name, reason: "文件数据为空或无效" });
      continue;
    }

    // 解码后大小校验（比 base64.length * 0.75 更精确）
    const decodedSize = Buffer.byteLength(f.data, "base64");
    if (decodedSize > MAX_SINGLE_FILE_SIZE_MB * 1024 * 1024) {
      errors.push({
        index: i,
        name: f.name,
        reason: `文件过大 (${(decodedSize / 1024 / 1024).toFixed(1)}MB > ${MAX_SINGLE_FILE_SIZE_MB}MB)`,
      });
      continue;
    }

    valid.push(f);
  }

  return { valid, errors };
}
```

**调用处改动**:
```typescript
// 替换原 line 64-65
const uploadedFiles: SerializedFile[] = Array.isArray(body.files) ? body.files : [];
const { valid, errors } = validateFiles(uploadedFiles);

if (valid.length === 0 && uploadedFiles.length > 0) {
  return jsonErr(`文件验证失败: ${errors.map(e => e.reason).join("; ")}`, 400);
}

if (errors.length > 0) {
  logger.warn("some files rejected", {
    sessionId,
    rejectedCount: errors.length,
    acceptedCount: valid.length,
    errors: errors.map(e => ({ name: e.name, reason: e.reason })),
  });
}

const attachments = collectRawAttachments(valid);
```

### 预期效果
- 恶意大 payload 在解码阶段被拦截
- 未知类型文件被拒绝（400）
- 部分文件不合格时，合法文件仍然通过，日志记录被拒绝的文件

---

## P1: `detectFileType` 未知类型处理（`lib/file-utils.ts`）

### 当前状态
```typescript
function detectFileType(name: string): "pdf" | "word" | "excel" {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "pdf") return "pdf";
  if (ext === "docx" || ext === "doc") return "word";
  if (ext === "xlsx" || ext === "xls") return "excel";
  return "word"; // ← 静默伪装
}
```

### 修复方案

**方案 A（严格模式 — 推荐）**: 返回 `null`，调用方决定如何处理

```typescript
function detectFileType(name: string): "pdf" | "word" | "excel" | null {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "pdf") return "pdf";
  if (ext === "docx" || ext === "doc") return "word";
  if (ext === "xlsx" || ext === "xls") return "excel";
  return null;
}
```

`serializeFiles` 中处理：
```typescript
const fileType = detectFileType(file.name);
if (!fileType) {
  console.error(`Unsupported file type: "${file.name}"`);
  continue; // 跳过不支持的文件
}
results.push({ name: file.name, type: fileType, data });
```

**同时更新 `SerializedFile` 接口以匹配后端**:
```typescript
export interface SerializedFile {
  name: string;
  type: "pdf" | "word" | "excel" | "image"; // 补上 image
  data: string;
}
```

### 预期效果
- `.png`、`.mp4` 等不支持的扩展名在客户端就被拒绝
- 类型定义与服务端统一

---

## P1: 超限文件用户反馈（`components/presales/file-upload-menu.tsx`）

### 当前状态
```typescript
if (f.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
  continue; // 静默丢弃
}
```

### 修复方案

**思路**: 不引入新依赖（无 sonner/toast），利用现有的 Context 机制传递错误信息，用内联错误横幅展示。

1. **扩展 Context** — 在 `PresalesState` 中新增 `uploadError: string | null` 字段
2. **`addAttachments` 改为返回值反馈** — 返回被拒绝的文件信息
3. **UI 展示** — 在 `FileUploadMenu` 或 `ConfigBar` 中用临时横幅展示

**具体改动**:

`file-upload-menu.tsx`:
```typescript
function handleFiles(files: FileList | null) {
  if (!files) return;
  const valid: File[] = [];
  const rejected: string[] = [];
  for (const f of Array.from(files)) {
    if (f.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
      rejected.push(`${f.name} (${(f.size / 1024 / 1024).toFixed(1)}MB > ${MAX_FILE_SIZE_MB}MB)`);
      continue;
    }
    valid.push(f);
  }
  if (valid.length > 0) addAttachments(valid);
  if (rejected.length > 0) {
    setUploadError(`以下文件超过 ${MAX_FILE_SIZE_MB}MB 限制: ${rejected.join(", ")}`);
  }
}
```

新增内联错误展示:
```tsx
{uploadError && (
  <div className="text-xs text-destructive bg-destructive/10 px-2 py-1 rounded mt-1">
    {uploadError}
    <button onClick={() => setUploadError(null)} className="ml-2 underline">关闭</button>
  </div>
)}
```

### 预期效果
- 用户选择超限文件后立即看到红色提示
- 合法文件仍然被添加

---

## P2: 序列化失败传播（`lib/file-utils.ts` + `agent-chat-panel.tsx`）

### 当前状态
```typescript
} catch (err) {
  console.error(`Failed to serialize file "${file.name}":`, err);
  // Skip files that fail to read — 静默跳过
}
```

### 修复方案

让 `serializeFiles` 返回被跳过的错误信息：

```typescript
export interface SerializeResult {
  files: SerializedFile[];
  errors: Array<{ name: string; error: string }>;
}

export async function serializeFiles(files: File[]): Promise<SerializeResult> {
  const results: SerializedFile[] = [];
  const errors: Array<{ name: string; error: string }> = [];
  for (const file of files) {
    try {
      const fileType = detectFileType(file.name);
      if (!fileType) {
        errors.push({ name: file.name, error: `不支持的文件类型` });
        continue;
      }
      const data = await fileToBase64(file);
      results.push({ name: file.name, type: fileType, data });
    } catch (err) {
      errors.push({
        name: file.name,
        error: err instanceof Error ? err.message : "读取失败",
      });
    }
  }
  return { files: results, errors };
}
```

`agent-chat-panel.tsx` 调用处:
```typescript
const { files, errors } = await serializeFiles(filesRef.current);
if (errors.length > 0) {
  // 触发用户可见的错误提示（通过 Context 或回调）
  setUploadError(`文件处理失败: ${errors.map(e => `${e.name}: ${e.error}`).join("; ")}`);
}
```

### 预期效果
- 文件读取失败时用户能看到具体错误
- 不阻塞正常文件的发送

---

## P2: 拖拽/粘贴上传（`agent-chat-panel.tsx`）

### 当前状态
`InputBar` 原生支持 `onPaste` 和 `isDragOver` props，但无人传入。

### 修复方案

利用现有 `InputBar` props，在 `agent-chat-panel.tsx` 中接入：

```typescript
// 新增状态
const [isDragOver, setIsDragOver] = useState(false);

// InputBar props
<InputBar
  isDragOver={isDragOver}
  onPaste={(e) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    const files: File[] = [];
    for (const item of Array.from(items)) {
      const file = item.getAsFile();
      if (file) files.push(file);
    }
    if (files.length > 0) {
      e.preventDefault();
      handleFiles(files); // → addAttachments + size check
    }
  }}
  // ...
/>

// 包裹层绑定拖拽事件
<div
  className="flex flex-col h-full"
  onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
  onDragLeave={() => setIsDragOver(false)}
  onDrop={(e) => {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer?.files) {
      handleFiles(Array.from(e.dataTransfer.files));
    }
  }}
>
```

### 预期效果
- 支持拖拽文件到聊天区域
- 支持 Ctrl+V 粘贴文件

---

## P3: `input` 添加 `multiple` 属性（`file-upload-menu.tsx`）

```diff
- <input ref={pdfRef} type="file" accept=".pdf" className="hidden" ... />
+ <input ref={pdfRef} type="file" accept=".pdf" className="hidden" multiple ... />
// 三个 input 均添加
```

### 预期效果
- 用户可一次选择多个同类型文件

---

## P3: `filesRef` 竞态（`agent-chat-panel.tsx:100`）

### 当前状态
```typescript
const files = await serializeFiles(filesRef.current);
// ...
filesRef.current = []; // 立即清空
```

如果在 `serializeFiles(filesRef.current)` 执行期间，用户又添加了新文件，这些新文件会随 `filesRef.current = []` 一起被清空。

### 修复方案

用 snapshot 模式：先拍快照，再原子性地移除已序列化的文件：

```typescript
async fetch(url, init) {
  if (init?.body) {
    const bodyObj = JSON.parse(init.body as string);
    // 先拍快照
    const snapshot = [...filesRef.current];
    // 序列化快照
    const { files } = await serializeFiles(snapshot);
    if (files.length > 0) {
      bodyObj.files = files;
      init.body = JSON.stringify(bodyObj);
    }
    // 只移除已序列化的文件，保留并发新增的
    filesRef.current = filesRef.current.slice(snapshot.length);
  }
  return fetch(url, init);
},
```

### 预期效果
- 发送期间新增的文件不会被错误清空
- 发完消息后上次残留的文件被正确清理

---

## 实施顺序

按优先级执行，每批完成后运行 `pnpm typecheck` + `pnpm lint` 验证：

| 批次 | 包含 |
|------|------|
| **第1批** | P0 #1（服务端校验）+ P1 #2（detectFileType） + P1 #4（类型统一） |
| **第2批** | P1 #3（超限反馈）+ P2 #5（序列化失败传播） |
| **第3批** | P2 #6（拖拽粘贴）+ P3 #8（multiple）+ P3 #9（竞态修复） |

## 涉及文件清单

| 文件 | 改动类型 | 批次 |
|------|----------|------|
| `lib/constants.ts` | 新增常量 | 1 |
| `app/api/chat/route.ts` | 新增 validateFiles + 调用 | 1 |
| `lib/file-utils.ts` | detectFileType 返回 null + SerializeResult + 类型统一 | 1/2 |
| `lib/presales-context.tsx` | 新增 uploadError 状态 | 2 |
| `components/presales/file-upload-menu.tsx` | 超限反馈 UI + multiple | 2/3 |
| `components/presales/agent-chat-panel.tsx` | serializeFiles 调用适配 + 拖拽粘贴 + 竞态修复 | 2/3 |
