#!/bin/sh

SDK_VERSION=$(cat package.json | sed -n -e '/version/ s/.*: *"\([^"]*\).*/\1/p')
echo "Building JavaScript SDK v$SDK_VERSION...\n"
browserify -s asyngular index.js > asyngular-client.js && uglifyjs asyngular-client.js -o asyngular-client.min.js
