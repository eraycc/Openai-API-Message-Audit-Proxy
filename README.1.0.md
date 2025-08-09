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
```
审核API请请求方式及返回参数
均为get请求
https://apiv1.iminbk.com/base64?word=base64处理(原消息)
https://apiv1.iminbk.com/?word={原消息，可以使用urlencode}
违规内容的返回：
{
  "status": "done",
  "verdict": "malicious",
  "rule_id": "generic.87",
  "data": {
    "size": "106",
    "today_scan_total": "831181",
    "match_string": "5pON5L2g",
    "descr": "There is illegal content",
    "EngineType": "dsm",
    "Engine Version": "2025.06.15"
  }
}
安全内容返回：
{
  "status": "done",
  "verdict": "security",
  "rule_id": "",
  "data": {
    "size": "4",
    "today_scan_total": "831219",
    "match_string": "null",
    "descr": "normal",
    "EngineType": "dsm",
    "Engine Version": "2025.06.15"
  }
}
```
4. **速率限制**：使用 Deno KV 实现基于时间窗口的请求限制
5. **灵活路由**：支持路径代理和直接URL代理两种模式

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
### Deno deploy部署
1. 首先fork该项目
2. 在 Deno Deploy 中创建新项目
3. 连接 GitHub 仓库，并选择fork的该项目
4. 填写其他信息后，将入口设置为 `deno.ts`，并进行部署，然后到设置内配置环境变量 `API_SITES`（可选）
5. enjoy it

### huggingface & docker部署
偷懒：
[一键fork](https://huggingface.co/spaces/g2i/aichataudit/blob/main/Dockerfile?duplicate=true)

抱脸docker自部署：
1. 新建一个space，选空docker
2. 复制项目中的Dockerfile-huggingface内容
3. space file内创建文件
4. 文件名：Dockerfile
5. 把复制的内容粘贴到Dockerfile内
6. 修改或自行设置相关环境变量evn配置
7. 保存即可开始编译并运行
8. enjoy it ＆ 保活

docker部署：
```
docker pull ghcr.io/eraycc/openai-api-message-audit-proxy:latest
或者
Dockerfile：
FROM ghcr.io/eraycc/openai-api-message-audit-proxy:latest
```
