# 使用官方 Deno alpine 镜像
FROM denoland/deno:alpine-2.4.3

# 安装 git (alpine 使用 apk)
RUN apk add --no-cache git

# 克隆仓库并清理.git目录
RUN git clone https://github.com/eraycc/Openai-API-Message-Audit-Proxy.git /app \
    && rm -rf /app/.git

# 设置工作目录
WORKDIR /app

# 缓存依赖 (提前执行以减少构建时间)
RUN deno cache main.ts

# 暴露端口
EXPOSE 8000

# 设置环境变量 (可根据需要覆盖)
ENV API_SITES='[{"path":"openai","baseurl":"https://api.openai.com","ratelimit":0,"msg-audit-config":{"AuditPath":"/v1/chat/completions","AuditParameter":"messages"}}]'

# 启动应用 (Deno 2.4.3 兼容的权限设置)
CMD ["deno", "run", \
    "--allow-net", \
    "--allow-env", \
    "--allow-read", \
    "--allow-write", \
    "--allow-ffi", \
    "--no-prompt", \
    "--no-check", \
    "main.ts"]
