Asyngular JavaScript Client
======

Asyngular Client is the client-side component of Asyngular.

## Setting up

To install, run:

```bash
npm install asyngular-client
```

## How to use

The asyngular-client script is called `asyngular-client.js` (located in the main asyngular-client directory).
Embed it in your HTML page like that:

```html
<script type="text/javascript" src="/asyngular-client.js"></script>
```
- Note that the src attribute may be different depending on how you setup your HTTP server

Once you have embedded the client asyngular-client.js into your page, you will gain access to a global asyngular object.

## Connect Options

See all available options : https://socketcluster.io/#!/docs/api-socketcluster-client

```js
var options = {
  path: '/socketcluster/',
  port: 8000,
  hostname: '127.0.0.1',
  autoConnect: true,
  secure: false,
  rejectUnauthorized: false,
  connectTimeout: 10000, //milliseconds
  ackTimeout: 10000, //milliseconds
  channelPrefix: null,
  disconnectOnUnload: true,
  multiplex: true,
  autoReconnectOptions: {
    initialDelay: 10000, //milliseconds
    randomness: 10000, //milliseconds
    multiplier: 1.5, //decimal
    maxDelay: 60000 //milliseconds
  },
  authEngine: null,
  codecEngine: null,
  subscriptionRetryOptions: {},
  query: {
    yourparam: 'hello'
  }
};
```

## Developing

#### Install all dependencies

```bash
cd asyngular-client

npm install -g gulp gulp-cli browserify uglify-js

npm install
```

#### Building

#### Via Browserify

To build Asyngular Client with browserify, use:

```bash
./browserify-build.sh
```

Or use

```bash
browserify -s asyngular index.js > asyngular-client.js && uglifyjs asyngular-client.js -o asyngular-client.min.js
```

#### Via Gulp

To build the client with Gulp, use:

```bash
./gulp-build.sh
```

## Change log

See the 'releases' section for changes: https://github.com/SocketCluster/asyngular-client/releases

## License

(The MIT License)

Copyright (c) 2013-2019 SocketCluster.io

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the 'Software'), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED 'AS IS', WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
