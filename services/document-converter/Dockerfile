FROM node:24-bookworm-slim
RUN sed -i 's|http://deb.debian.org/debian-security|http://mirrors.aliyun.com/debian-security|g; s|http://deb.debian.org/debian|http://mirrors.aliyun.com/debian|g' /etc/apt/sources.list.d/debian.sources && apt-get -o Acquire::http::Timeout=30 update && apt-get install -y --no-install-recommends libreoffice-impress fonts-noto-cjk && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY server.js /app/server.js
USER 65534:65534
ENV HOME=/tmp
EXPOSE 8080
CMD ["node", "/app/server.js"]
