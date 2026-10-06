FROM node:24.21.0-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1 AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . ./

ARG VITE_API_URL
ENV VITE_API_URL=${VITE_API_URL}

RUN npm run build

FROM nginx:stable-alpine

ENV CSP_CONNECT_SRC="'self'" \
    BACKEND_UPSTREAM="backend:8000" \
    BROWSER_PROXY_UPLOAD_MAX_BODY_SIZE="5g"
# Make Alpine repository metadata part of the BuildKit cache key so newly
# published security fixes invalidate the cached OS-upgrade layer.
ADD https://dl-cdn.alpinelinux.org/alpine/v3.24/main/x86_64/APKINDEX.tar.gz /tmp/alpine-main-APKINDEX.tar.gz
ADD https://dl-cdn.alpinelinux.org/alpine/v3.24/community/x86_64/APKINDEX.tar.gz /tmp/alpine-community-APKINDEX.tar.gz
RUN apk upgrade --no-cache \
    && apk add --no-cache 'libexpat>=2.8.5-r0' \
    && rm -f /tmp/alpine-main-APKINDEX.tar.gz /tmp/alpine-community-APKINDEX.tar.gz
COPY nginx.conf.template /etc/nginx/bucketreef.conf.template
COPY docker-entrypoint.sh /usr/local/bin/bucketreef-entrypoint
COPY --from=build /app/dist /usr/share/nginx/html
RUN chmod 0755 /usr/local/bin/bucketreef-entrypoint

USER 101:101

EXPOSE 8080

ENTRYPOINT ["/usr/local/bin/bucketreef-entrypoint"]
