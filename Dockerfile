# 使用官方 Deno alpine 镜像
FROM denoland/deno:alpine-2.4.3

# 设置工作目录
WORKDIR /app

# 复制所有项目文件到镜像
COPY . .

# 缓存依赖（Deno 会自动处理依赖）
RUN deno cache main.ts

# 暴露端口
EXPOSE 8000

# 设置环境变量
ENV API_SITES='[{"path":"openai","baseurl":"https://api.openai.com","ratelimit":0,"msg-audit-config":{"AuditPath":"/v1/chat/completions","AuditParameter":"messages"}}]'

# 启动应用
CMD ["deno", "run", \
    "--allow-net", \
    "--allow-env", \
    "--allow-read", \
    "--allow-write", \
    "--allow-ffi", \
    "--no-prompt", \
    "--no-check", \
    "main.ts"]
