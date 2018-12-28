Asyngular JavaScript Client
======

Asyngular Client is the client-side component of Asyngular.

## Setting up

You will need to install both ```asyngular-client``` and ```asyngular-server``` (https://github.com/SocketCluster/asyngular-server).

To install this module:
```bash
npm install asyngular-client
```

## How to use

The asyngular-client script is called `asyngular-client.js` (located in the main asyngular-client directory).
Embed it in your HTML page like that:
```html
<script type="text/javascript" src="/asyngular-client.js"></script>
```
\* Note that the src attribute may be different depending on how you setup your HTTP server.

Once you have embedded the client asyngular-client.js into your page, you will gain access to a global `asyngular` object.

### Connect to a server

```js
let socket = asyngular.create({
  hostname: 'localhost',
  port: 8000
});
```

### Transmit data

```js
// Transmit some data to the server.
// It does not expect a response from the server.
// From the server, it can be handled using either:
// - for await (let data of socket.receiver('foo')) {}
// - await socket.receiver('foo').once()
socket.transmit('foo', 123);
```

### Invoke an RPC

```js
(async () => {

  // Invoke an RPC on the server.
  // It expects a response from the server.
  // From the server, it can be handled using either:
  // - for await (let req of socket.procedure('myProc')) {}
  // - await socket.procedure('myProc').once()
  let result = await socket.invoke('myProc', 123);
})();
```

### Subscribe to a channel

```js
(async () => {

  // Subscribe to a channel.
  let myChannel = socket.subscribe('myChannel');
  await myChannel.listener('subscribe');
  // myChannel.state is now 'subscribed'.

})();
```

### Publish data to a channel

```js
// Publish data to the channel from the socket.
myChannel.publish('This is a message');
```

### Consume data from a channel

```js
(async () => {

  for await (let data of myChannel) {
    // ...
  }

})();
```

### Connect over HTTPS:

```js
let options = {
  hostname: 'securedomain.com',
  secure: true,
  port: 443,
  rejectUnauthorized: false // Only necessary during debug if using a self-signed certificate
};
// Initiate the connection to the server
let socket = asyngular.create(options);
```

For more detailed examples of how to use Asyngular, see `test/integration.js`.
Also, see tests from the `asyngular-server` module.

### Connect Options

See all available options : https://socketcluster.io/#!/docs/api-socketcluster-client
```js
let options = {
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

### Install all dependencies

```bash
cd asyngular-client

npm install -g gulp gulp-cli browserify uglify-js

npm install
```

### Building

#### Via Browserify

To build Asyngular Client:

```bash
npm run build
```

## Change log

See the 'releases' section for changes: https://github.com/SocketCluster/asyngular-client/releases

## License

(The MIT License)

Copyright (c) 2013-2019 SocketCluster.io

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the 'Software'), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED 'AS IS', WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
