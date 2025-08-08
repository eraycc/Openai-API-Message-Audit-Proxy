# Openai-API-Message-Audit-Proxy
基于deno的openai兼容格式的请求审查代理API，可以审查违规聊天请求，针对违规聊天请求自动拦截并响应错误提示，支持速率限制，适用于公益站集成上游渠道时进行聊天请求消息审核以及上游API整体速率限制，避免对上游造成请求压力，以及因非法消息造成上游封禁导致渠道不可用等。

## 核心功能

1. **环境变量配置**：支持通过 `API_SITES` 环境变量配置多个API站点
```
API_SITES格式如下：
const DEFAULT_API_SITES: ApiSite[] = [
  {
    path: "openai",
    baseurl: "https://api.openai.com",
    ratelimit: 0,
    "msg-audit-config": {
      AuditPath: "/v1/chat/completions",
      AuditParameter: "messages"
    }
  },
  {
    path: "example", // 注意：path 应该是唯一的，不能重复
    baseurl: "https://api.example.com",
    ratelimit: 0 // 可选速率限制参数，为0不限制，默认为限制该API每分钟请求120次
    // 如果 msg-audit-config 是可选的，可以省略
  }
];
```
2. **消息审核**：只针对对聊天请求进行敏感词检测，基于[文本敏感词检测API - iMin博客](https://www.iminbk.com/archives/276.html)进行审核，感谢🙏这位大佬提供的审核API，其他如模型列表等请求则直接放行。
3. **速率限制**：使用 Deno KV 实现基于时间窗口的请求限制
4. **灵活路由**：支持路径代理和直接URL代理两种模式

## 使用示例

### 路径代理模式
```
https://xxx.deno.dev/proxy/openai/v1/chat/completions
→ https://api.openai.com/v1/chat/completions
```

### 直接URL代理模式
```
https://xxx.deno.dev/proxy/https://api.example.com/v1/models
→ https://api.example.com/v1/models
```

## 特性

- **高性能**：异步处理，支持高并发
- **智能审核**：自动选择URL编码或Base64编码
- **优雅降级**：审核API失败时允许请求通过，并在日志中记录错误日志
- **标准错误**：返回OpenAI兼容的错误格式
- **自动清理**：定期清理过期的速率限制记录

## 部署步骤

1. 首先fork该项目
2. 在 Deno Deploy 中创建新项目
3. 连接 GitHub 仓库，并选择fork的该项目
4. 填写其他信息后，将入口设置为 `main.ts`，并进行部署，然后到设置内配置环境变量 `API_SITES`（可选）
5. enjoy it

OpenAI API 内容审核 Proxy
- 高效审核代理
- 支持流式响应
- 易部署易配置
