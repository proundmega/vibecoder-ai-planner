#!/bin/sh
# Substitute runtime env var into nginx config before starting
HEALTH_LOG="${NGINX_HEALTH_LOG:-/dev/null}"
if [ "$NGINX_HEALTH_LOG" = "enabled" ]; then
    HEALTH_LOG="/var/log/nginx/access.log"
fi
sed "s|__HEALTH_LOG_PATH__|${HEALTH_LOG}|g" /etc/nginx/conf.d/default.conf.template > /etc/nginx/conf.d/default.conf
exec nginx -g 'daemon off;'
