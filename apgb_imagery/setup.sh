#!/usr/bin/env bash
set -euo pipefail

here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
runtime="$here/runtime"
secrets="$runtime/secrets"

mkdir -p "$secrets"
chmod 0700 "$runtime" "$secrets"

if [[ ! -f "$here/.env" ]]; then
    cp "$here/.env.example" "$here/.env"
    chmod 0600 "$here/.env"
    echo "Created $here/.env"
fi

if [[ ! -s "$secrets/geoserver_admin_user" ]]; then
    printf '%s\n' 'apgb_admin' > "$secrets/geoserver_admin_user"
fi

if [[ ! -s "$secrets/geoserver_admin_password" ]]; then
    if command -v openssl >/dev/null 2>&1; then
        openssl rand -base64 36 | tr -d '\n' > "$secrets/geoserver_admin_password"
    else
        od -An -N32 -tx1 /dev/urandom | tr -d ' \n' > "$secrets/geoserver_admin_password"
    fi
    printf '\n' >> "$secrets/geoserver_admin_password"
fi

chmod 0600 "$secrets/geoserver_admin_user" "$secrets/geoserver_admin_password"

admin_user=$(<"$secrets/geoserver_admin_user")
admin_password=$(<"$secrets/geoserver_admin_password")
printf 'machine 127.0.0.1 login %s password %s\n' \
    "$admin_user" "$admin_password" > "$secrets/geoserver.netrc"
chmod 0600 "$secrets/geoserver.netrc"

cat <<EOF
APGB service runtime is prepared.

On retina, start it with:
  cd $here
  docker compose up -d

After GeoServer reports healthy, run:
  ./configure_geoserver.sh
EOF
