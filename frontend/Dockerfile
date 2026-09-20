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
    BACKEND_UPSTREAM="backend:8000"
RUN apk upgrade --no-cache
COPY nginx.conf.template /etc/nginx/bucketreef.conf.template
COPY docker-entrypoint.sh /usr/local/bin/bucketreef-entrypoint
COPY --from=build /app/dist /usr/share/nginx/html
RUN chmod 0755 /usr/local/bin/bucketreef-entrypoint

USER 101:101

EXPOSE 8080

ENTRYPOINT ["/usr/local/bin/bucketreef-entrypoint"]
