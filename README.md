SocketCluster Client
======

SocketCluster Client is the client-side component of SocketCluster.

To install, run:

```bash
npm install socketcluster-client
```

The socketcluster-client script is called socketcluster.js (located in the main socketcluster-client directory) 
- You should include it in your HTML page using a &lt;script&gt; tag in order to interact with SocketCluster.

To build SocketCluster Client with browserify, use:

```
browserify -s socketCluster index.js > socketcluster.js
```

## How to use

Embed in your HTML page using (Note that the src attribute may be different depending on how you setup your HTTP server):

```html
<script type="text/javascript" src="/socketcluster.js"></script>
```

Once you have embedded the client socketcluster.js into your page, you will gain access to a global socketCluster object.
Then, to begin interacting with the SocketCluster cluster, you will need to establish a connection.
Once that's done, you will be able to emit events to the server and listen to incoming events (example code):

```js
var options = {
    port: 8000
};

// Initiate the connection to the server
var socket = socketCluster.connect(options);
socket.on('connect', function () {
    console.log('CONNECTED');
});

// Listen to an event called 'rand' from the server
socket.on('rand', function (num) {
    console.log('RANDOM: ' + num);
    var curHTML = document.body.innerHTML;
    curHTML += 'RANDOM: ' + num + '<br />';
    document.body.innerHTML = curHTML;
});
```

Example with HTTPS:

```js
var options = {
    protocol: 'https',
    hostname: 'example.com',
    port: 443
};

// Initiate the connection to the server
var socket = socketCluster.connect(options);
```