#!/bin/sh

SDK_VERSION=$(cat package.json | sed -n -e '/version/ s/.*: *"\([^"]*\).*/\1/p')
echo "Building JavaScript SDK v$SDK_VERSION...\n"
browserify -s socketcluster index.js > socketcluster-client.js && uglifyjs socketcluster-client.js -o socketcluster-client.min.js
