# OpenAI 兼容API消息审核代理服务

## 项目简介

本服务是基于 Deno 开发的 OpenAI 兼容API代理，提供消息内容审核、速率限制、自动封禁等增强功能，适用于对接上游 OpenAI 兼容API时进行安全防护。

## 核心功能

### 1. 消息内容审核
- 自动扫描聊天消息中的违规内容
- 支持中文和英文内容检测
- 基于 iMin 文本审核API实现
- 可配置审核路径和参数

### 2. 安全防护
- 请求频率限制（基于 Deno KV）
- 自动封禁频繁违规的令牌
- 敏感信息加密传输
- 违规操作实时告警

### 3. 代理功能
- 支持路径代理和直接URL代理两种模式
- 保持与 OpenAI API 完全兼容
- 自动处理流式和非流式响应

## 部署指南

### 环境变量配置

```bash
# 必填配置
# 加解密密码
ENCRYPTION_PASSWORD="your-encryption-password" 
# 加解密盐值
ENCRYPTION_SALT="your-encryption-salt"

# 微信推送配置
WXPUSHER_APP_TOKEN="AT_xxx"                     # 从WxPusher获取
WXPUSHER_UID="UID_xxx"                          # 接收消息的用户UID

# API站点配置（JSON格式）
API_SITES='[
  {
    "path": "openai",
    "baseurl": "https://api.openai.com",
    "ratelimit": 120,
    "MaxAuditNum": 12,
    "BanTimeInterval": 60,
    "BanTimeDuration": 60,
    "msg-audit-config": {
      "AuditPath": "/v1/chat/completions",
      "AuditParameter": "messages"
    }
  }
]'
```

### 部署方式

#### 1. Deno Deploy 部署

1. Fork 本项目仓库
2. 登录 Deno Deploy 控制台
3. 新建项目并连接 GitHub 仓库
4. 选择 deno.ts 作为入口文件（基于deno kv持久化存储）
5. 配置环境变量
6. 部署项目

#### 2. Docker 部署
```bash
docker pull ghcr.io/eraycc/openai-api-message-audit-proxy:latest
docker run -d \
  -e ENCRYPTION_PASSWORD="your-password" \
  -e ENCRYPTION_SALT="your-salt" \
  -e API_SITES='[...]' \
  -p 8000:8000 \
  ghcr.io/eraycc/openai-api-message-audit-proxy:latest
```

自定义构建可查看Dockerfile文件

#### 3. Hugging Face Space 部署
[一键fork](https://huggingface.co/spaces/g2i/aichataudit/blob/main/Dockerfile?duplicate=true)
或者：
1. 新建 Space 选择 Docker 模板
2. 上传 Dockerfile-huggingface 文件
3. 重命名为 Dockerfile
4. 配置环境变量
5. 部署应用

## 使用说明

### API 调用方式

#### 路径代理模式
```
https://your-domain.com/proxy/openai/v1/chat/completions
→ 代理到 → https://api.openai.com/v1/chat/completions
```

#### 直接URL代理模式
```
https://your-domain.com/proxy/https://api.example.com/v1/models
→ 代理到 → https://api.example.com/v1/models
```

### 内置工具

- `/encryption` - 加密工具页面
- `/decryption` - 解密工具页面
- `/api/encryption` - 加密API接口 (POST)
- `/api/decryption` - 解密API接口 (POST)

### iMin审核API

审核请求示例：
```
GET https://apiv1.iminbk.com/?word={URL编码内容}
或
GET https://apiv1.iminbk.com/base64?word={Base64编码内容}
```

响应格式：
```json
{
  "status": "done",
  "verdict": "malicious|security",
  "rule_id": "string",
  "data": {
    "descr": "违规描述",
    "match_string": "匹配内容"
  }
}
```

## 高级配置

### API站点配置详解

```typescript
interface ApiSite {
  path: string;               // 站点路径标识（必须唯一）
  baseurl: string;            // 基础API地址
  ratelimit?: number;         // 每分钟请求限制（0表示无限制）
  MaxAuditNum?: number;       // 最大允许违规次数（默认12）
  BanTimeInterval?: number;   // 统计时间窗口（分钟，默认60）
  BanTimeDuration?: number;   // 封禁时长（分钟，默认60）
  "msg-audit-config"?: {     // 消息审核配置
    AuditPath?: string;       // 需要审核的API路径
    AuditParameter?: string;  // 包含消息内容的参数名
  };
}
```

### 封禁机制工作原理

1. 当检测到违规内容时，记录违规次数
2. 在 `BanTimeInterval` 时间窗口内：
   - 违规次数 < `MaxAuditNum`：返回警告
   - 违规次数 ≥ `MaxAuditNum`：封禁令牌
3. 封禁持续 `BanTimeDuration` 分钟后自动解除

## 响应示例

### 正常响应
与上游API响应完全一致

### 违规响应
```json
{
  "error": {
    "message": "内容包含违禁词汇（3/12次违规）",
    "type": "access_denied",
    "param": "敏感词示例",
    "code": "rule_123"
  }
}
```

### 被封禁响应
```json
{
  "error": {
    "message": "因在60分钟内触发12次违规，已暂时封禁60分钟，剩余封禁时间：45分钟",
    "type": "access_denied",
    "code": "banned"
  }
}
```

## 常见问题

### 审核相关
Q: 为什么发hi有响应，发别的会失败？ 
A: 发送包含单条"hi"消息的测试请求，将收到模拟响应，如果请求失败可能是上游失效

Q: 加密密码丢失怎么办？  
A: 必须重新部署并更新所有加密内容

Q: 审核API不可用时会发生什么？
A: 服务会降级处理，允许请求通过并在控制台记录警告

### 部署相关
Q: Docker 容器启动失败怎么办？
A: 检查环境变量是否配置正确，特别是 JSON 格式的 API_SITES

Q: 如何查看 Deno Deploy 的日志？
A: 在 Deno Deploy 控制台的 "Logs" 标签页查看实时日志

### 微信推送
Q: 如何获取 WxPusher 配置？
A: 参考官方文档：https://wxpusher.zjiecode.com/docs/#/

Q: 为什么收不到微信通知？
A: 检查：1) APP_TOKEN 和 UID 是否正确 2) 网络是否可达微信服务器

## 交流

如有任何问题，请提交 GitHub Issue
