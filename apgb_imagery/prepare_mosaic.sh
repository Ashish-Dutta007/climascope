#!/bin/sh
set -eu

source_root=${APGB_CONTAINER_SOURCE_ROOT:-/mnt/apgb_source}
mosaic_root=${APGB_CONTAINER_MOSAIC_ROOT:-/opt/apgb_mosaic}
expected_min=${EXPECTED_MIN_TILES:-4261}

mkdir -p "$mosaic_root"

count=0
for square in NG NK NL NM NR NS NW NX; do
    tile_dir="$source_root/tiles_125mm_$square"
    if [ ! -d "$tile_dir" ]; then
        echo "Missing canonical APGB directory: $tile_dir" >&2
        exit 1
    fi

    for tile in "$tile_dir"/*_RGB_125mm.tif; do
        [ -f "$tile" ] || continue
        name=${tile##*/}
        destination="$mosaic_root/$name"
        if [ -L "$destination" ]; then
            if [ "$(readlink "$destination")" != "$tile" ]; then
                echo "Conflicting APGB tile basename: $name" >&2
                exit 1
            fi
        elif [ -e "$destination" ]; then
            echo "APGB mosaic entry is not a managed symlink: $name" >&2
            exit 1
        else
            ln -s "$tile" "$destination"
        fi
        count=$((count + 1))
    done
done

if [ "$count" -lt "$expected_min" ]; then
    echo "Found only $count canonical APGB tiles; expected at least $expected_min" >&2
    exit 1
fi

# GeoServer runs unprivileged and needs to create its small spatial index here.
chmod 0777 "$mosaic_root"
printf '%s\n' "$count" > "$mosaic_root/.tile_count"

# Fix the exposed coverage name before GeoServer creates the spatial index.
cat > "$mosaic_root/indexer.properties" <<'EOF'
Schema=*the_geom:Polygon,location:String
PropertyCollectors=
Name=aerial_125mm
TypeName=aerial_125mm
Caching=true
AbsolutePath=false
EOF

echo "Prepared APGB ImageMosaic with $count canonical source tiles"
