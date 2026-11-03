#!/bin/sh
set -e

echo "Waiting for PostgreSQL..."
until docker compose exec -T postgres pg_isready -U "${POSTGRES_USER:-flyt}" -d "${POSTGRES_DB:-flyt_db}" >/dev/null 2>&1; do
  sleep 1
done

echo "Waiting for Redis..."
until docker compose exec -T redis redis-cli -a "${REDIS_PASSWORD:-flyt_redis_secret}" ping 2>/dev/null | grep -q PONG; do
  sleep 1
done

echo "Dependencies ready."
