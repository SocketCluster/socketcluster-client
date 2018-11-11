const assert = require('assert');
const socketClusterServer = require('socketcluster-server');
const socketClusterClient = require('../');
const localStorage = require('localStorage');

// Add to the global scope like in browser.
global.localStorage = localStorage;

let portNumber = 8008;

let clientOptions;
let serverOptions;

let allowedUsers = {
  bob: true,
  kate: true,
  alice: true
};

let server, client;
let validSignedAuthTokenBob = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VybmFtZSI6ImJvYiIsImV4cCI6MzE2Mzc1ODk3ODIxNTQ4NywiaWF0IjoxNTAyNzQ3NzQ2fQ.GLf_jqi_qUSCRahxe2D2I9kD8iVIs0d4xTbiZMRiQq4';
let validSignedAuthTokenKate = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VybmFtZSI6ImthdGUiLCJleHAiOjMxNjM3NTg5NzgyMTU0ODcsImlhdCI6MTUwMjc0Nzc5NX0.Yfb63XvDt9Wk0wHSDJ3t7Qb1F0oUVUaM5_JKxIE2kyw';
let invalidSignedAuthToken = 'fakebGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.fakec2VybmFtZSI6ImJvYiIsImlhdCI6MTUwMjYyNTIxMywiZXhwIjoxNTAyNzExNjEzfQ.fakemYcOOjM9bzmS4UYRvlWSk_lm3WGHvclmFjLbyOk';

const TOKEN_EXPIRY_IN_SECONDS = 60 * 60 * 24 * 366 * 5000;

function wait(duration) {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve();
    }, duration);
  });
};

function connectionHandler(socket) {
  async function handleLogin() {
    let rpc = await socket.procedure('login').once();
    if (allowedUsers[rpc.data.username]) {
      rpc.data.exp = Math.round(Date.now() / 1000) + TOKEN_EXPIRY_IN_SECONDS;
      socket.setAuthToken(rpc.data);
      rpc.end();
    } else {
      let err = new Error('Failed to login');
      err.name = 'FailedLoginError';
      rpc.error(err);
    }
  }
  handleLogin();

  async function handleSetAuthKey() {
    let rpc = await socket.procedure('setAuthKey').once();
    server.signatureKey = rpc.data;
    server.verificationKey = rpc.data;
    rpc.end();
  }
  handleSetAuthKey();

  async function handlePerformTask() {
    for await (let rpc of socket.procedure('performTask')) {
      setTimeout(function () {
        rpc.end();
      }, 1000);
    }
  }
  handlePerformTask();
};

describe('Integration tests', function () {
  beforeEach('Run the server before start', async function () {
    serverOptions = {
      authKey: 'testkey',
      ackTimeout: 200
    };

    server = socketClusterServer.listen(portNumber, serverOptions);
    async function handleServerConnection() {
      for await (let {socket} of server.listener('connection')) {
        connectionHandler(socket);
      }
    }
    handleServerConnection();

    server.addMiddleware(server.MIDDLEWARE_AUTHENTICATE, async function (req) {
      if (req.authToken.username === 'alice') {
        let err = new Error('Blocked by MIDDLEWARE_AUTHENTICATE');
        err.name = 'AuthenticateMiddlewareError';
        throw err;
      }
    });

    clientOptions = {
      hostname: '127.0.0.1',
      port: portNumber,
      ackTimeout: 200
    };

    await server.listener('ready').once();
  });

  afterEach('Shut down server afterwards', async function () {
    let cleanupTasks = [];
    global.localStorage.removeItem('socketCluster.authToken');
    if (client) {
      if (client.state !== client.CLOSED) {
        cleanupTasks.push(
          Promise.race([
            client.listener('disconnect').once(),
            client.listener('connectAbort').once()
          ])
        );
        client.disconnect();
      } else {
        client.disconnect();
      }
    }
    cleanupTasks.push(
      server
      .close()
      .then(() => {
        portNumber++;
      })
    );
    await Promise.all(cleanupTasks);
  });

  describe('Creation', function () {

    it('Should automatically connect socket on creation by default', async function () {
      clientOptions = {
        hostname: '127.0.0.1',
        port: portNumber
      };

      client = socketClusterClient.create(clientOptions);

      assert.equal(client.state, client.CONNECTING);
    });

    it('Should not automatically connect socket if autoConnect is set to false', async function () {
      clientOptions = {
        hostname: '127.0.0.1',
        port: portNumber,
        autoConnect: false
      };

      client = socketClusterClient.create(clientOptions);

      assert.equal(client.state, client.CLOSED);
    });
  });

  describe('Errors', function () {
    it('Should be able to emit the error event locally on the socket', async function () {
      client = socketClusterClient.create(clientOptions);
      let err = null;

      (async () => {
        for await (let {error} of client.listener('error')) {
          err = error;
        }
      })();

      (async () => {
        for await (let status of client.listener('connect')) {
          let error = new Error('Custom error');
          error.name = 'CustomError';
          client.emit('error', {error});
        }
      })();

      await wait(100);

      assert.notEqual(err, null);
      assert.equal(err.name, 'CustomError');
    });
  });

  describe('Authentication', function () {
    it('Should not send back error if JWT is not provided in handshake', async function () {
      client = socketClusterClient.create(clientOptions);
      let event = await client.listener('connect').once();
      assert.equal(event.authError === undefined, true);
    });

    it('Should be authenticated on connect if previous JWT token is present', async function () {
      global.localStorage.setItem('socketCluster.authToken', validSignedAuthTokenBob);
      client = socketClusterClient.create(clientOptions);

      let event = await client.listener('connect').once();
      assert.equal(client.authState, 'authenticated');
      assert.equal(event.isAuthenticated, true);
      assert.equal(event.authError === undefined, true);
    });

    it('Should send back error if JWT is invalid during handshake', async function () {
      global.localStorage.setItem('socketCluster.authToken', validSignedAuthTokenBob);
      client = socketClusterClient.create(clientOptions);

      let event = await client.listener('connect').once();
      assert.notEqual(event, null);
      assert.equal(event.isAuthenticated, true);
      assert.equal(event.authError, null);

      assert.notEqual(client.signedAuthToken, null);
      assert.notEqual(client.authToken, null);

      // Change the setAuthKey to invalidate the current token.
      await client.invoke('setAuthKey', 'differentAuthKey');

      client.disconnect();
      client.connect();

      event = await client.listener('connect').once();

      assert.equal(event.isAuthenticated, false);
      assert.notEqual(event.authError, null);
      assert.equal(event.authError.name, 'AuthTokenInvalidError');

      // When authentication fails, the auth token properties on the client
      // socket should be set to null; that way it's not going to keep
      // throwing the same error every time the socket tries to connect.
      assert.equal(client.signedAuthToken, null);
      assert.equal(client.authToken, null);

      // Set authKey back to what it was.
      await client.invoke('setAuthKey', serverOptions.authKey);
    });

    it('Should allow switching between users', async function () {
      global.localStorage.setItem('socketCluster.authToken', validSignedAuthTokenBob);
      client = socketClusterClient.create(clientOptions);
      let authenticateTriggered = false;
      let authStateChangeTriggered = false;

      await client.listener('connect').once();

      assert.notEqual(client.authToken, null);
      assert.equal(client.authToken.username, 'bob');

      client.invoke('login', {username: 'alice'});

      (async () => {
        await client.listener('authenticate').once();
        authenticateTriggered = true;
        assert.equal(client.authState, 'authenticated');
        assert.notEqual(client.authToken, null);
        assert.equal(client.authToken.username, 'alice');
      })();

      (async () => {
        await client.listener('authStateChange').once();
        authStateChangeTriggered = true;
      })();

      await wait(100);

      assert.equal(authenticateTriggered, true);
      assert.equal(authStateChangeTriggered, false);
    });

    it('If token engine signing is synchronous, authentication can be captured using the authenticate event', async function () {
      let port = 8509;
      server = socketClusterServer.listen(port, {
        authKey: serverOptions.authKey,
        authSignAsync: false
      });

      (async () => {
        let {socket} = await server.listener('connection').once();
        connectionHandler(socket);
      })();

      await server.listener('ready').once();

      client = socketClusterClient.create({
        hostname: clientOptions.hostname,
        port: port
      });

      await client.listener('connect').once();

      await client.invoke('login', {username: 'bob'});
      await client.listener('authenticate').once();

      assert.equal(client.authState, 'authenticated');
      assert.notEqual(client.authToken, null);
      assert.equal(client.authToken.username, 'bob');
    });

    it('If token engine signing is asynchronous, authentication can be captured using the authenticate event', async function () {
      let port = 8510;
      server = socketClusterServer.listen(port, {
        authKey: serverOptions.authKey,
        authSignAsync: true
      });

      (async () => {
        let {socket} = await server.listener('connection').once();
        connectionHandler(socket);
      })();

      await server.listener('ready').once();

      client = socketClusterClient.create({
        hostname: clientOptions.hostname,
        port: port
      });

      await client.listener('connect').once();

      client.invoke('login', {username: 'bob'});

      await client.listener('authenticate').once();

      assert.equal(client.authState, 'authenticated');
      assert.notEqual(client.authToken, null);
      assert.equal(client.authToken.username, 'bob');
    });

    it('If token verification is synchronous, authentication can be captured using the authenticate event', async function () {
      let port = 8511;
      server = socketClusterServer.listen(port, {
        authKey: serverOptions.authKey,
        authVerifyAsync: false
      });

      (async () => {
        let {socket} = await server.listener('connection').once();
        connectionHandler(socket);
      })();

      await server.listener('ready').once();

      client = socketClusterClient.create({
        hostname: clientOptions.hostname,
        port: port
      });

      await client.listener('connect').once();

      await Promise.all([
        (async () => {
          await client.invoke('login', {username: 'bob'});
          await client.listener('authenticate').once();
          client.disconnect();
        })(),
        (async () => {
          await client.listener('authenticate').once();
          await client.listener('disconnect').once();
          client.connect();
          let event = await client.listener('connect').once();

          assert.equal(event.isAuthenticated, true);
          assert.notEqual(client.authToken, null);
          assert.equal(client.authToken.username, 'bob');
        })()
      ]);
    });

    it('Should start out in pending authState and switch to unauthenticated if no token exists', async function () {
      client = socketClusterClient.create(clientOptions);
      assert.equal(client.authState, 'unauthenticated');

      (async () => {
        let status = await client.listener('authStateChange').once();
        throw new Error('authState should not change after connecting without a token');
      })();

      await wait(1000);
    });

    it('Should deal with auth engine errors related to saveToken function', async function () {
      global.localStorage.setItem('socketCluster.authToken', validSignedAuthTokenBob);
      client = socketClusterClient.create(clientOptions);

      let caughtError;

      (async () => {
        for await (let {error} of client.listener('error')) {
          caughtError = error;
        }
      })();

      await client.listener('connect').once();

      let oldSaveTokenFunction = client.auth.saveToken;
      client.auth.saveToken = function (tokenName, tokenValue, options) {
        let err = new Error('Failed to save token');
        err.name = 'FailedToSaveTokenError';
        return Promise.reject(err);
      };
      assert.notEqual(client.authToken, null);
      assert.equal(client.authToken.username, 'bob');

      let authStatus = await client.authenticate(validSignedAuthTokenKate);

      assert.notEqual(authStatus, null);
      // The error here comes from the client auth engine and does not prevent the
      // authentication from taking place, it only prevents the token from being
      // stored correctly on the client.
      assert.equal(authStatus.isAuthenticated, true);
      // authError should be null because the error comes from the client-side auth engine
      // whereas authError is for server-side errors (e.g. JWT errors).
      assert.equal(authStatus.authError, null);

      assert.notEqual(client.authToken, null);
      assert.equal(client.authToken.username, 'kate');

      await wait(10);

      assert.notEqual(caughtError, null);
      assert.equal(caughtError.name, 'FailedToSaveTokenError');
      client.auth.saveToken = oldSaveTokenFunction;
    });

    it('Should gracefully handle authenticate abortion due to disconnection', async function () {
      client = socketClusterClient.create(clientOptions);

      await client.listener('connect').once();

      let authenticatePromise = await client.authenticate(validSignedAuthTokenBob);
      client.disconnect();

      try {
        await authenticatePromise;
      } catch (err) {
        assert.notEqual(err, null);
        assert.equal(err.name, 'BadConnectionError');
        assert.equal(client.authState, 'unauthenticated');
      }
    });

    it('Should go through the correct sequence of authentication state changes when dealing with disconnections; part 1', async function () {
      client = socketClusterClient.create(clientOptions);

      let expectedAuthStateChanges = [
        'unauthenticated->authenticated'
      ];
      let authStateChanges = [];

      (async () => {
        for await (status of client.listener('authStateChange')) {
          authStateChanges.push(status.oldAuthState + '->' + status.newAuthState);
        }
      })();

      assert.equal(client.authState, 'unauthenticated');

      await client.listener('connect').once();
      assert.equal(client.authState, 'unauthenticated');

      (async () => {
        await client.invoke('login', {username: 'bob'});
        await client.listener('authenticate').once();
        client.disconnect();
      })();

      assert.equal(client.authState, 'unauthenticated');

      let {signedAuthToken, authToken} = await client.listener('authenticate').once();

      assert.notEqual(signedAuthToken, null);
      assert.notEqual(authToken, null);

      assert.equal(client.authState, 'authenticated');

      await client.listener('disconnect').once();

      // In case of disconnection, the socket maintains the last known auth state.
      assert.equal(client.authState, 'authenticated');

      await client.authenticate(signedAuthToken);

      assert.equal(client.authState, 'authenticated');
      assert.equal(JSON.stringify(authStateChanges), JSON.stringify(expectedAuthStateChanges));
      client.closeListener('authStateChange');
    });

    it('Should go through the correct sequence of authentication state changes when dealing with disconnections; part 2', async function () {
      global.localStorage.setItem('socketCluster.authToken', validSignedAuthTokenBob);
      client = socketClusterClient.create(clientOptions);

      let expectedAuthStateChanges = [
        'unauthenticated->authenticated',
        'authenticated->unauthenticated',
        'unauthenticated->authenticated',
        'authenticated->unauthenticated'
      ];
      let authStateChanges = [];

      (async () => {
        for await (status of client.listener('authStateChange')) {
          authStateChanges.push(status.oldAuthState + '->' + status.newAuthState);
        }
      })();

      assert.equal(client.authState, 'unauthenticated');

      await client.listener('connect').once();

      assert.equal(client.authState, 'authenticated');
      client.deauthenticate();
      assert.equal(client.authState, 'unauthenticated');
      let authenticatePromise = client.authenticate(validSignedAuthTokenBob);
      assert.equal(client.authState, 'unauthenticated');

      await authenticatePromise;

      assert.equal(client.authState, 'authenticated');

      client.disconnect();

      assert.equal(client.authState, 'authenticated');
      await client.deauthenticate();
      assert.equal(client.authState, 'unauthenticated');

      assert.equal(JSON.stringify(authStateChanges), JSON.stringify(expectedAuthStateChanges));
    });

    it('Should go through the correct sequence of authentication state changes when dealing with disconnections; part 3', async function () {
      global.localStorage.setItem('socketCluster.authToken', validSignedAuthTokenBob);
      client = socketClusterClient.create(clientOptions);

      let expectedAuthStateChanges = [
        'unauthenticated->authenticated',
        'authenticated->unauthenticated'
      ];
      let authStateChanges = [];

      (async () => {
        for await (let status of client.listener('authStateChange')) {
          authStateChanges.push(status.oldAuthState + '->' + status.newAuthState);
        }
      })();

      assert.equal(client.authState, 'unauthenticated');

      await client.listener('connect').once();

      assert.equal(client.authState, 'authenticated');
      let authenticatePromise = client.authenticate(invalidSignedAuthToken);
      assert.equal(client.authState, 'authenticated');

      try {
        await authenticatePromise;
      } catch (err) {
        assert.notEqual(err, null);
        assert.equal(err.name, 'AuthTokenInvalidError');
        assert.equal(client.authState, 'unauthenticated');
        assert.equal(JSON.stringify(authStateChanges), JSON.stringify(expectedAuthStateChanges));
      }
    });

    it('Should go through the correct sequence of authentication state changes when authenticating as a user while already authenticated as another user', async function () {
      global.localStorage.setItem('socketCluster.authToken', validSignedAuthTokenBob);
      client = socketClusterClient.create(clientOptions);

      let expectedAuthStateChanges = [
        'unauthenticated->authenticated'
      ];
      let authStateChanges = [];

      (async () => {
        for await (let status of client.listener('authStateChange')) {
          authStateChanges.push(status.oldAuthState + '->' + status.newAuthState);
        }
      })();

      let expectedAuthTokenChanges = [
        validSignedAuthTokenBob,
        validSignedAuthTokenKate
      ];
      let authTokenChanges = [];

      (async () => {
        for await (let event of client.listener('authenticate')) {
          authTokenChanges.push(client.signedAuthToken);
        }
      })();

      (async () => {
        for await (let event of client.listener('deauthenticate')) {
          authTokenChanges.push(client.signedAuthToken);
        }
      })();

      assert.equal(client.authState, 'unauthenticated');

      await client.listener('connect').once();

      assert.equal(client.authState, 'authenticated');
      assert.equal(client.authToken.username, 'bob');
      let authenticatePromise = client.authenticate(validSignedAuthTokenKate);

      assert.equal(client.authState, 'authenticated');

      await authenticatePromise;

      assert.equal(client.authState, 'authenticated');
      assert.equal(client.authToken.username, 'kate');
      assert.equal(JSON.stringify(authStateChanges), JSON.stringify(expectedAuthStateChanges));
      assert.equal(JSON.stringify(authTokenChanges), JSON.stringify(expectedAuthTokenChanges));
    });

    it('Should wait for socket to be authenticated before subscribing to waitForAuth channel', async function () {
      client = socketClusterClient.create(clientOptions);

      let privateChannel = client.subscribe('priv', {waitForAuth: true});
      assert.equal(privateChannel.state, 'pending');

      await client.listener('connect').once();
      assert.equal(privateChannel.state, 'pending');

      client.invoke('login', {username: 'bob'});
      await client.listener('subscribe').once();
      assert.equal(privateChannel.state, 'subscribed');

      client.disconnect();
      assert.equal(privateChannel.state, 'pending');

      client.authenticate(validSignedAuthTokenBob);
      await client.listener('subscribe').once();
      assert.equal(privateChannel.state, 'subscribed');
    });

    it('Subscriptions (including those with waitForAuth option) should have priority over the authenticate action', async function () {
      global.localStorage.setItem('socketCluster.authToken', validSignedAuthTokenBob);
      client = socketClusterClient.create(clientOptions);

      let expectedAuthStateChanges = [
        'unauthenticated->authenticated',
        'authenticated->unauthenticated'
      ];
      let initialSignedAuthToken;
      let authStateChanges = [];

      (async () => {
        for await (let status of client.listener('authStateChange')) {
          authStateChanges.push(status.oldAuthState + '->' + status.newAuthState);
        }
      })();

      (async () => {
        let error = null;
        try {
          await client.authenticate(invalidSignedAuthToken);
        } catch (err) {
          error = err;
        }
        assert.notEqual(error, null);
        assert.equal(error.name, 'AuthTokenInvalidError');
      })();

      let privateChannel = client.subscribe('priv', {waitForAuth: true});
      assert.equal(privateChannel.state, 'pending');

      (async () => {
        let event = await client.listener('connect').once();
        initialSignedAuthToken = client.signedAuthToken;
        assert.equal(event.isAuthenticated, true);
        assert.equal(privateChannel.state, 'pending');

        await Promise.race([
          (async () => {
            let err = await privateChannel.listener('subscribeFail').once();
            // This shouldn't happen because the subscription should be
            // processed before the authenticate() call with the invalid token fails.
            throw new Error('Failed to subscribe to channel: ' + err.message);
          })(),
          (async () => {
            await privateChannel.listener('subscribe').once();
            assert.equal(privateChannel.state, 'subscribed');
          })()
        ]);
      })();

      (async () => {
        // The subscription already went through so it should still be subscribed.
        let {oldSignedAuthToken, oldAuthToken} = await client.listener('deauthenticate').once();
        // The subscription already went through so it should still be subscribed.
        assert.equal(privateChannel.state, 'subscribed');
        assert.equal(client.authState, 'unauthenticated');
        assert.equal(client.authToken, null);

        assert.notEqual(oldAuthToken, null);
        assert.equal(oldAuthToken.username, 'bob');
        assert.equal(oldSignedAuthToken, initialSignedAuthToken);

        let privateChannel2 = client.subscribe('priv2', {waitForAuth: true});

        await privateChannel2.listener('subscribe').once();

        // This line should not execute.
        throw new Error('Should not subscribe because the socket is not authenticated');
      })();

      await wait(1000);
      client.closeListener('authStateChange');
      assert.equal(JSON.stringify(authStateChanges), JSON.stringify(expectedAuthStateChanges));
    });

    it('Should trigger the close event if the socket disconnects in the middle of the handshake phase', async function () {
      client = socketClusterClient.create(clientOptions);
      let aborted = false;
      let diconnected = false;
      let closed = false;

      (async () => {
        await client.listener('connectAbort').once();
        aborted = true;
      })();

      (async () => {
        await client.listener('disconnect').once();
        diconnected = true;
      })();

      (async () => {
        await client.listener('close').once();
        closed = true;
      })();

      client.disconnect();

      await wait(300);

      assert.equal(aborted, true);
      assert.equal(diconnected, false);
      assert.equal(closed, true);
    });

    it('Should trigger the close event if the socket disconnects after the handshake phase', async function () {
      client = socketClusterClient.create(clientOptions);
      let aborted = false;
      let diconnected = false;
      let closed = false;

      (async () => {
        await client.listener('connectAbort').once();
        aborted = true;
      })();

      (async () => {
        await client.listener('disconnect').once();
        diconnected = true;
      })();

      (async () => {
        await client.listener('close').once();
        closed = true;
      })();

      (async () => {
        for await (let event of client.listener('connect')) {
          client.disconnect();
        }
      })();

      await wait(300);

      assert.equal(aborted, false);
      assert.equal(diconnected, true);
      assert.equal(closed, true);
    });
  });

  describe('Emitting remote events', function () {
    it('Should not throw error on socket if ackTimeout elapses before response to event is sent back', async function () {
      client = socketClusterClient.create(clientOptions);

      let caughtError;
      let clientError;

      (async () => {
        for await (let {error} of client.listener('error')) {
          clientError = error;
        }
      })();

      let responseError;

      for await (let event of client.listener('connect')) {
        try {
          await client.invoke('performTask', 123);
        } catch (err) {
          responseError = err;
        }
        await wait(250);
        try {
          client.disconnect();
        } catch (err) {
          caughtError = err;
        }
        break;
      }

      assert.notEqual(responseError, null);
      assert.equal(caughtError, null);
    });
  });

  describe('Reconnecting socket', function () {
    it('Should disconnect socket with code 1000 and reconnect', async function () {
      client = socketClusterClient.create(clientOptions);

      await client.listener('connect').once();

      let disconnectCode;
      let disconnectReason;

      (async () => {
        for await (let event of client.listener('disconnect')) {
          disconnectCode = event.code;
          disconnectReason = event.reason;
        }
      })();

      client.reconnect();
      await client.listener('connect').once();

      assert.equal(disconnectCode, 1000);
      assert.equal(disconnectReason, undefined);
    });

    it('Should disconnect socket with custom code and data when socket.reconnect() is called with arguments', async function () {
      client = socketClusterClient.create(clientOptions);

      await client.listener('connect').once();

      let disconnectCode;
      let disconnectReason;

      (async () => {
        let event = await client.listener('disconnect').once();
        disconnectCode = event.code;
        disconnectReason = event.reason;
      })();

      client.reconnect(1000, 'About to reconnect');
      await client.listener('connect').once();

      assert.equal(disconnectCode, 1000);
      assert.equal(disconnectReason, 'About to reconnect');
    });
  });

  describe('Order of events', function () {
    it('Should trigger unsubscribe event on channel before disconnect event', async function () {
      client = socketClusterClient.create(clientOptions);
      let hasUnsubscribed = false;

      let fooChannel = client.subscribe('foo');

      (async () => {
        for await (let event of fooChannel.listener('subscribe')) {
          await wait(100);
          client.disconnect();
        }
      })();

      (async () => {
        for await (let event of fooChannel.listener('unsubscribe')) {
          hasUnsubscribed = true;
        }
      })();

      await client.listener('disconnect').once();
      assert.equal(hasUnsubscribed, true);
    });

    it('Should not invoke subscribeFail event if connection is aborted', async function () {
      client = socketClusterClient.create(clientOptions);
      let hasSubscribeFailed = false;
      let gotBadConnectionError = false;
      let wasConnected = false;

      (async () => {
        for await (let event of client.listener('connect')) {
          wasConnected = true;
          (async () => {
            try {
              await client.invoke('someEvent', 123);
            } catch (err) {
              if (err.name === 'BadConnectionError') {
                gotBadConnectionError = true;
              }
            }
          })();

          let fooChannel = client.subscribe('foo');
          (async () => {
            for await (let event of fooChannel.listener('subscribeFail')) {
              hasSubscribeFailed = true;
            }
          })();

          (async () => {
            await wait(0);
            client.disconnect();
          })();
        }
      })();

      await client.listener('close').once();
      await wait(100);
      assert.equal(wasConnected, true);
      assert.equal(gotBadConnectionError, true);
      assert.equal(hasSubscribeFailed, false);
    });

    it('Should resolve invoke Promise with BadConnectionError after triggering the disconnect event', async function () {
      client = socketClusterClient.create(clientOptions);
      let messageList = [];

      (async () => {
        try {
          await client.invoke('someEvent', 123);
        } catch (err) {
          messageList.push({
            type: 'error',
            error: err
          });
        }
      })();

      (async () => {
        for await (let event of client.listener('disconnect')) {
          messageList.push({
            type: 'disconnect',
            code: event.code,
            reason: event.reason
          });
        }
      })();

      await client.listener('connect').once();
      client.disconnect();
      await wait(200);
      assert.equal(messageList.length, 2);
      assert.equal(messageList[0].type, 'disconnect');
      assert.equal(messageList[1].type, 'error');
      assert.equal(messageList[1].error.name, 'BadConnectionError');
    });

    it('Should reconnect if transmit is called on a disconnected socket', async function () {
      let fooReceiverTriggered = false;

      (async () => {
        for await (let {socket} of server.listener('connection')) {
          (async () => {
            for await (let data of socket.receiver('foo')) {
              fooReceiverTriggered = true;
            }
          })();
        }
      })();

      client = socketClusterClient.create(clientOptions);

      let clientError;

      (async () => {
        for await (let {error} of client.listener('error')) {
          clientError = error;
        }
      })();

      let eventList = [];

      (async () => {
        for await (let event of client.listener('connecting')) {
          eventList.push('connecting');
        }
      })();

      (async () => {
        for await (let event of client.listener('connect')) {
          eventList.push('connect');
        }
      })();

      (async () => {
        for await (let event of client.listener('disconnect')) {
          eventList.push('disconnect');
        }
      })();

      (async () => {
        for await (let event of client.listener('close')) {
          eventList.push('close');
        }
      })();

      (async () => {
        for await (let event of client.listener('connectAbort')) {
          eventList.push('connectAbort');
        }
      })();

      (async () => {
        await client.listener('connect').once();
        client.disconnect();
        client.transmit('foo', 123);
      })();

      await wait(1000);

      let expectedEventList = ['connect', 'disconnect', 'close', 'connecting', 'connect'];
      assert.equal(JSON.stringify(eventList), JSON.stringify(expectedEventList));
      assert.equal(fooReceiverTriggered, true);
    });

    it('Should correctly handle multiple successive connect and disconnect calls', async function () {
      client = socketClusterClient.create(clientOptions);

      let eventList = [];

      let clientError;
      (async () => {
        for await (let {error} of client.listener('error')) {
          clientError = error;
        }
      })();

      (async () => {
        for await (let event of client.listener('connecting')) {
          eventList.push({
            event: 'connecting'
          });
        }
      })();

      (async () => {
        for await (let event of client.listener('connect')) {
          eventList.push({
            event: 'connect'
          });
        }
      })();

      (async () => {
        for await (let event of client.listener('connectAbort')) {
          eventList.push({
            event: 'connectAbort',
            code: event.code,
            reason: event.reason
          });
        }
      })();

      (async () => {
        for await (let event of client.listener('disconnect')) {
          eventList.push({
            event: 'disconnect',
            code: event.code,
            reason: event.reason
          });
        }
      })();

      (async () => {
        for await (let event of client.listener('close')) {
          eventList.push({
            event: 'close',
            code: event.code,
            reason: event.reason
          });
        }
      })();

      client.disconnect(1000, 'One');
      client.connect();
      client.disconnect(4444, 'Two');

      (async () => {
        await client.listener('connect').once();
        client.disconnect(4455, 'Three');
      })();

      client.connect();

      await wait(200);

      let expectedEventList = [
        {
          event: 'connectAbort',
          code: 1000,
          reason: 'One'
        },
        {
          event: 'close',
          code: 1000,
          reason: 'One'
        },
        {
          event: 'connecting'
        },
        {
          event: 'connectAbort',
          code: 4444,
          reason: 'Two'
        },
        {
          event: 'close',
          code: 4444,
          reason: 'Two'
        },
        {
          event: 'connecting'
        },
        {
          event: 'connect'
        },
        {
          event: 'disconnect',
          code: 4455,
          reason: 'Three'
        },
        {
          event: 'close',
          code: 4455,
          reason: 'Three'
        },
      ];
      assert.equal(JSON.stringify(eventList), JSON.stringify(expectedEventList));
    });
  });

  describe('Ping/pong', function () {
    it('Should disconnect if ping is not received before timeout', async function () {
      clientOptions.connectTimeout = 500;
      client = socketClusterClient.create(clientOptions);

      assert.equal(client.pingTimeout, 500);

      (async () => {
        for await (let event of client.listener('connect')) {
          assert.equal(client.transport.pingTimeout, server.options.pingTimeout);
          // Hack to make the client ping independent from the server ping.
          client.transport.pingTimeout = 500;
        }
      })();

      let disconnectCode = null;
      let clientError = null;

      (async () => {
        for await (let {error} of client.listener('error')) {
          clientError = error;
        }
      })();

      (async () => {
        for await (let event of client.listener('disconnect')) {
          disconnectCode = event.code;
        }
      })();

      await wait(1000);

      assert.equal(disconnectCode, 4000);
      assert.notEqual(clientError, null);
      assert.equal(clientError.name, 'SocketProtocolError');
    });

    it('Should not disconnect if ping is not received before timeout when pingTimeoutDisabled is true', async function () {
      clientOptions.connectTimeout = 500;
      clientOptions.pingTimeoutDisabled = true;
      client = socketClusterClient.create(clientOptions);

      assert.equal(client.pingTimeout, 500);

      let clientError = null;
      (async () => {
        for await (let {error} of client.listener('error')) {
          clientError = error;
        }
      })();

      await wait(1000);
      assert.equal(clientError, null);
    });
  });

  describe('Utilities', function () {
    it('Can encode a string to base64 and then decode it back to utf8', function (done) {
      client = socketClusterClient.create(clientOptions);
      let encodedString = client.encodeBase64('This is a string');
      assert.equal(encodedString, 'VGhpcyBpcyBhIHN0cmluZw==');
      let decodedString = client.decodeBase64(encodedString);
      assert.equal(decodedString, 'This is a string');
      done();
    });
  });
});
