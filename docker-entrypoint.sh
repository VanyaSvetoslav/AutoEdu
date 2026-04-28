#!/bin/sh
# Entry point for the AutoEdu container.
#
# The image runs the bot as the unprivileged `node` user (uid 1000), but the
# data directory at /data is a host bind-mount in production (see
# docker-compose.yml). On a fresh host that mount inherits the host
# directory's ownership — typically root:root — so better-sqlite3 fails to
# open /data/autoedu.sqlite with SQLITE_CANTOPEN.
#
# To fix that without making the user `chown` anything by hand, we start as
# root, ensure /data exists and is owned by node:node, and only then drop
# privileges via gosu and exec the real command.
set -e

mkdir -p /data
chown -R node:node /data

exec gosu node "$@"
