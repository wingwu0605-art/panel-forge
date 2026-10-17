# 零依赖 Node 服务镜像：docker build -t panel-forge . && docker run -p 7311:7311 panel-forge
FROM node:22-alpine
WORKDIR /app

# 只用标准库，没有 npm install 步骤
COPY package.json ./
COPY server.mjs ./
COPY lib ./lib
COPY web ./web
COPY docs ./docs

ENV PORT=7311
ENV HOST=0.0.0.0
EXPOSE 7311

# 不要在镜像里写死 Key；用 docker run -e LLM_API_KEY=... 注入
CMD ["node", "server.mjs"]
