#!/bin/sh
set -eu

mkdir -p /tmp/client_temp /tmp/proxy_temp /tmp/fastcgi_temp /tmp/uwsgi_temp /tmp/scgi_temp
envsubst '${CSP_CONNECT_SRC} ${BACKEND_UPSTREAM} ${BROWSER_PROXY_UPLOAD_MAX_BODY_SIZE}' \
  < /etc/nginx/bucketreef.conf.template \
  > /tmp/nginx.conf

exec nginx -c /tmp/nginx.conf -g 'daemon off;'
