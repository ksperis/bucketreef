FROM python:3.11-slim

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    HOME=/tmp \
    TMPDIR=/tmp

COPY requirements.txt ./
# Make Debian security metadata part of the BuildKit cache key so newly
# published security fixes invalidate the cached OS-upgrade layer.
ADD https://deb.debian.org/debian-security/dists/trixie-security/InRelease /tmp/debian-security-InRelease
RUN apt-get update \
    && apt-get upgrade --yes \
    && rm -f /tmp/debian-security-InRelease \
    && rm -rf /var/lib/apt/lists/* \
    && pip install --no-cache-dir -r requirements.txt \
    && pip uninstall --yes setuptools wheel

COPY alembic.ini ./
COPY alembic ./alembic
COPY app ./app

RUN groupadd --gid 10001 bucketreef \
    && useradd --uid 10001 --gid 10001 --no-create-home --home-dir /tmp --shell /usr/sbin/nologin bucketreef \
    && mkdir -p /data /tmp \
    && chown -R 10001:10001 /app /data /tmp

USER 10001:10001

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--no-proxy-headers"]
