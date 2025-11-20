# Dockerfile para Steam Bundle Scraper
# Otimizado para Orange Pi (ARM64)

FROM python:3.11-slim

# Evita prompts interativos
ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

# Diretório de trabalho
WORKDIR /app

# Instala dependências do sistema necessárias para Playwright
RUN apt-get update && apt-get install -y \
    wget \
    gnupg \
    ca-certificates \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libatspi2.0-0 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libgbm1 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libwayland-client0 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxkbcommon0 \
    libxrandr2 \
    xdg-utils \
    && rm -rf /var/lib/apt/lists/*

# Copia requirements primeiro (cache de layer)
COPY scraper/requirements.txt .

# Instala dependências Python
RUN pip install --no-cache-dir -r requirements.txt

# Instala browsers do Playwright (apenas Chromium para economizar espaço)
RUN playwright install chromium && \
    playwright install-deps chromium

# Copia código do scraper
COPY scraper/ ./scraper/

# Cria diretórios necessários
RUN mkdir -p /app/logs /app/data

# Usuário não-root para segurança
RUN useradd -m -u 1000 scraper && \
    chown -R scraper:scraper /app

USER scraper

# Comando padrão
CMD ["python", "-m", "scraper.main_with_db"]
