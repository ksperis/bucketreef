FROM golang:1.26.9-alpine@sha256:3082400e369fa24d5fc60bca20edab3f6d604e0c5a690ec66b295eff4dd87ade AS supercronic-build
ARG SUPERCRONIC_VERSION=v0.2.49
RUN CGO_ENABLED=0 GOBIN=/out \
    go install -ldflags "-X main.Version=${SUPERCRONIC_VERSION}" \
    "github.com/aptible/supercronic@${SUPERCRONIC_VERSION}"

FROM alpine:3.24.1

RUN apk upgrade --no-cache \
    && apk add --no-cache ca-certificates tzdata \
    && addgroup -g 10001 -S scheduler \
    && adduser -u 10001 -S -D -H -G scheduler scheduler

COPY --from=supercronic-build /out/supercronic /usr/local/bin/supercronic

COPY --chown=10001:10001 ops/cron /opt/cron
COPY --chown=10001:10001 scheduler/entrypoint.sh /usr/local/bin/scheduler-entrypoint
RUN chmod 0755 /usr/local/bin/supercronic /usr/local/bin/scheduler-entrypoint /opt/cron/*.sh

USER 10001:10001

ENTRYPOINT ["/usr/local/bin/scheduler-entrypoint"]
