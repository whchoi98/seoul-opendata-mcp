# syntax=docker/dockerfile:1
# AgentCore Runtime 요구: linux/arm64
FROM --platform=linux/arm64 node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM --platform=linux/arm64 node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
EXPOSE 8000
# 키는 이미지에 포함하지 않는다 — Runtime env(SEOUL_API_KEY 등)로 주입
CMD ["node", "dist/http.js"]
