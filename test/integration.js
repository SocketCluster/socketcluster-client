var assert = require('assert');
var socketClusterServer = require('socketcluster-server');
var socketClusterClient = require('../');
var localStorage = require('localStorage');

// Add to the global scope like in browser.
global.localStorage = localStorage;

var PORT = 8008;

var clientOptions = {
  hostname: '127.0.0.1',
  port: PORT,
  multiplex: false,
  ackTimeout: 200
};

var serverOptions = {
  authKey: 'testkey',
  ackTimeout: 200
};

var allowedUsers = {
  bob: true,
  kate: true,
  alice: true
};

var server, client;
var validSignedAuthTokenBob = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VybmFtZSI6ImJvYiIsImV4cCI6MTU5NjE0NzQ3NzQ3LCJpYXQiOjE1MDI3NDc3NDZ9.hjR769TX0vpDzZPl7a1UgudYtuUj8KikJ105IV3UHsc';
var validSignedAuthTokenKate = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VybmFtZSI6ImthdGUiLCJleHAiOjE1OTYxNDc0Nzc5NiwiaWF0IjoxNTAyNzQ3Nzk1fQ.mIyyBLYZIvVCS1dFTpv-vlYXqUj8mndGx9Znp9Nko_c';
var invalidSignedAuthToken = 'fakebGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.fakec2VybmFtZSI6ImJvYiIsImlhdCI6MTUwMjYyNTIxMywiZXhwIjoxNTAyNzExNjEzfQ.fakemYcOOjM9bzmS4UYRvlWSk_lm3WGHvclmFjLbyOk';

var TOKEN_EXPIRY_IN_SECONDS = 60 * 60 * 24 * 366 * 5000;

var connectionHandler = function (socket) {
  socket.once('login', function (userDetails, respond) {
    if (allowedUsers[userDetails.username]) {
      userDetails.exp = Math.round(Date.now() / 1000) + TOKEN_EXPIRY_IN_SECONDS;
      socket.setAuthToken(userDetails);
      respond();
    } else {
      var err = new Error('Failed to login');
      err.name = 'FailedLoginError';
      respond(err);
    }
  });
  socket.once('setAuthKey', function (newAuthKey, respond) {
    server.signatureKey = newAuthKey;
    server.verificationKey = newAuthKey;
    respond();
  });
  socket.on('performTask', function (action, respond) {
    setTimeout(function () {
      respond();
    }, 1000);
  });
};

describe('integration tests', function () {
  before('run the server before start', function (done) {
    server = socketClusterServer.listen(PORT, serverOptions);
    server.on('connection', connectionHandler);

    server.addMiddleware(server.MIDDLEWARE_AUTHENTICATE, function (req, next) {
      if (req.authToken.username == 'alice') {
        var err = new Error('Blocked by MIDDLEWARE_AUTHENTICATE');
        err.name = 'AuthenticateMiddlewareError';
        next(err);
      } else {
        next();
      }
    });

    server.once('ready', function () {
      done();
    });
  });

  after('shut down server afterwards', function (done) {
    server.close();
    done();
  });

  afterEach('shut down client after each test', function (done) {
    global.localStorage.removeItem('socketCluster.authToken');
    if (client && client.state != client.CLOSED) {
      client.once('disconnect', function () {
        done();
      });
      client.once('connectAbort', function () {
        done();
      });
      client.destroy();
    } else {
      done();
    }
  });

  describe('authentication', function () {

    it('should not send back error if JWT is not provided in handshake', function (done) {
      client = socketClusterClient.connect(clientOptions);
      client.once('connect', function (status) {
        assert.equal(status.authError === undefined, true);
        done()
      });
    });

    it('should be authenticated on connect if previous JWT token is present', function (done) {
      global.localStorage.setItem('socketCluster.authToken', validSignedAuthTokenBob);
      client = socketClusterClient.connect(clientOptions);
      client.once('connect', function (statusA) {
        assert.equal(client.authState, 'authenticated');
        assert.equal(statusA.isAuthenticated, true);
        assert.equal(statusA.authError === undefined, true);
        done();
      });
    });

    it('should send back error if JWT is invalid during handshake', function (done) {
      global.localStorage.setItem('socketCluster.authToken', validSignedAuthTokenBob);
      client = socketClusterClient.connect(clientOptions);

      client.once('connect', function (statusA) {
        assert.notEqual(statusA, null);
        assert.equal(statusA.isAuthenticated, true);
        assert.equal(statusA.authError, null);

        assert.notEqual(client.signedAuthToken, null);
        assert.notEqual(client.authToken, null);

        // Change the setAuthKey to invalidate the current token.
        client.emit('setAuthKey', 'differentAuthKey', function (err) {
          assert.equal(err, null);

          client.once('disconnect', function () {
            client.once('connect', function (statusB) {
              assert.equal(statusB.isAuthenticated, false);
              assert.notEqual(statusB.authError, null);
              assert.equal(statusB.authError.name, 'AuthTokenInvalidError');

              // When authentication fails, the auth token properties on the client
              // socket should be set to null; that way it's not going to keep
              // throwing the same error every time the socket tries to connect.
              assert.equal(client.signedAuthToken, null);
              assert.equal(client.authToken, null);

              // Set authKey back to what it was.
              client.emit('setAuthKey', serverOptions.authKey, function (err) {
                assert.equal(err == null, true);
                done();
              });
            });

            client.connect();
          });

          client.disconnect();
        });
      });
    });

    it('should allow switching between users', function (done) {
      client = socketClusterClient.connect(clientOptions);
      client.once('connect', function (statusA) {
        client.emit('login', {username: 'alice'});

        client.once('authTokenChange', function (signedToken) {
          assert.equal(client.authState, 'authenticated');
          assert.notEqual(client.authToken, null);
          assert.equal(client.authToken.username, 'alice');

          done();
        });
      });
    });

    it('token should be available inside login callback if token engine signing is synchronous', function (done) {
      var port = 8009;
      server = socketClusterServer.listen(port, {
        authKey: serverOptions.authKey,
        authSignAsync: false
      });
      server.once('connection', connectionHandler);
      server.once('ready', function () {
        client = socketClusterClient.connect({
          hostname: clientOptions.hostname,
          port: port,
          multiplex: false
        });
        client.once('connect', function (statusA) {
          client.emit('login', {username: 'bob'}, function (err) {
            assert.equal(client.authState, 'authenticated');
            assert.notEqual(client.authToken, null);
            assert.equal(client.authToken.username, 'bob');
            done();
          });
        });
      });
    });

    it('if token engine signing is asynchronous, authentication can be captured using the authenticate event', function (done) {
      var port = 8010;
      server = socketClusterServer.listen(port, {
        authKey: serverOptions.authKey,
        authSignAsync: true
      });
      server.once('connection', connectionHandler);
      server.once('ready', function () {
        client = socketClusterClient.connect({
          hostname: clientOptions.hostname,
          port: port,
          multiplex: false
        });
        client.once('connect', function (statusA) {
          client.emit('login', {username: 'bob'});
          client.once('authenticate', function (newSignedToken) {
            assert.equal(client.authState, 'authenticated');
            assert.notEqual(client.authToken, null);
            assert.equal(client.authToken.username, 'bob');
            done();
          });
        });
      });
    });

    it('should still work if token verification is asynchronous', function (done) {
      var port = 8011;
      server = socketClusterServer.listen(port, {
        authKey: serverOptions.authKey,
        authVerifyAsync: false
      });
      server.once('connection', connectionHandler);
      server.once('ready', function () {
        client = socketClusterClient.connect({
          hostname: clientOptions.hostname,
          port: port,
          multiplex: false
        });
        client.once('connect', function (statusA) {
          client.emit('login', {username: 'bob'});
          client.once('authenticate', function (newSignedToken) {
            client.once('disconnect', function () {
              client.once('connect', function (statusB) {
                assert.equal(statusB.isAuthenticated, true);
                assert.notEqual(client.authToken, null);
                assert.equal(client.authToken.username, 'bob');
                done();
              });
              client.connect();
            });
            client.disconnect();
          });
        });
      });
    });

    it('should start out in pending authState and switch to unauthenticated if no token exists', function (done) {
      client = socketClusterClient.connect(clientOptions);
      assert.equal(client.authState, 'unauthenticated');

      var handler = function (status) {
        throw new Error('authState should not change after connecting without a token');
      };

      client.once('authStateChange', handler);

      setTimeout(function () {
        client.off('authStateChange', handler);
        done();
      }, 1000);
    });

    it('should deal with auth engine errors related to saveToken function', function (done) {
      global.localStorage.setItem('socketCluster.authToken', validSignedAuthTokenBob);
      client = socketClusterClient.connect(clientOptions);

      var caughtError;
      client.on('error', function (err) {
        caughtError = err;
      });

      client.once('connect', function () {
        var oldSaveTokenFunction = client.auth.saveToken;
        client.auth.saveToken = function (tokenName, tokenValue, options, callback) {
          var err = new Error('Failed to save token');
          err.name = 'FailedToSaveTokenError';
          callback(err);
        };
        assert.notEqual(client.authToken, null);
        assert.equal(client.authToken.username, 'bob');

        client.authenticate(validSignedAuthTokenKate, function (err, authStatus) {
          assert.notEqual(authStatus, null);
          // The error here comes from the auth engine and does not prevent the
          // authentication from taking place, it only prevents the token from being
          // stored correctly on the client.
          assert.equal(authStatus.isAuthenticated, true);
          // authError should be null because the error comes from the client-side auth engine
          // whereas authError is for server-side errors (e.g. JWT errors).
          assert.equal(authStatus.authError, null);

          assert.notEqual(client.authToken, null);
          assert.equal(client.authToken.username, 'kate');
          setTimeout(function () {
            assert.notEqual(caughtError, null);
            assert.equal(caughtError.name, 'FailedToSaveTokenError');
            client.auth.saveToken = oldSaveTokenFunction;
            done();
          }, 10);
        });
      });
    });

    it('should gracefully handle authenticate abortion due to disconnection', function (done) {
      client = socketClusterClient.connect(clientOptions);

      client.once('connect', function (statusA) {
        client.authenticate(validSignedAuthTokenBob, function (err, authStatus) {
          assert.notEqual(err, null);
          assert.equal(err.name, 'BadConnectionError');
          assert.notEqual(authStatus, null);
          assert.notEqual(authStatus.isAuthenticated, null);
          // authError should be null because the error which occurred is not related
          // specifically to authentication.
          assert.equal(authStatus.authError, null);
          done();
        });
        client.disconnect();
      });
    });

    it('should go through the correct sequence of authentication state changes when dealing with disconnections; part 1', function (done) {
      client = socketClusterClient.connect(clientOptions);

      var expectedAuthStateChanges = [
        'unauthenticated->authenticated'
      ];
      var authStateChanges = [];
      client.on('authStateChange', function (status) {
        authStateChanges.push(status.oldState + '->' + status.newState);
      });

      assert.equal(client.authState, 'unauthenticated');

      client.once('connect', function (statusA) {
        client.once('authenticate', function (newSignedToken) {
          client.once('disconnect', function () {
            assert.equal(client.authState, 'authenticated');
            client.authenticate(newSignedToken, function (newSignedToken) {
              assert.equal(client.authState, 'authenticated');
              assert.equal(JSON.stringify(authStateChanges), JSON.stringify(expectedAuthStateChanges));
              client.off('authStateChange');
              done();
            });
            assert.equal(client.authState, 'authenticated');
          });
          assert.equal(client.authState, 'authenticated');
          client.disconnect();
          // In case of disconnection, the socket maintains the last known auth state.
          assert.equal(client.authState, 'authenticated');
        });
        assert.equal(client.authState, 'unauthenticated');
        client.emit('login', {username: 'bob'});
        assert.equal(client.authState, 'unauthenticated');
      });
    });

    it('should go through the correct sequence of authentication state changes when dealing with disconnections; part 2', function (done) {
      global.localStorage.setItem('socketCluster.authToken', validSignedAuthTokenBob);
      client = socketClusterClient.connect(clientOptions);

      var expectedAuthStateChanges = [
        'unauthenticated->authenticated',
        'authenticated->unauthenticated',
        'unauthenticated->authenticated',
        'authenticated->unauthenticated'
      ];
      var authStateChanges = [];
      client.on('authStateChange', function (status) {
        authStateChanges.push(status.oldState + '->' + status.newState);
      });

      assert.equal(client.authState, 'unauthenticated');

      client.once('connect', function (statusA) {
        assert.equal(client.authState, 'authenticated');
        client.deauthenticate();
        assert.equal(client.authState, 'unauthenticated');
        client.authenticate(validSignedAuthTokenBob, function (err) {
          assert.equal(err, null);
          assert.equal(client.authState, 'authenticated');
          client.once('disconnect', function () {
            assert.equal(client.authState, 'authenticated');
            client.deauthenticate();
            assert.equal(client.authState, 'unauthenticated');
            assert.equal(JSON.stringify(authStateChanges), JSON.stringify(expectedAuthStateChanges));
            done();
          });
          client.disconnect();
        });
        assert.equal(client.authState, 'unauthenticated');
      });
    });

    it('should go through the correct sequence of authentication state changes when dealing with disconnections; part 3', function (done) {
      global.localStorage.setItem('socketCluster.authToken', validSignedAuthTokenBob);
      client = socketClusterClient.connect(clientOptions);

      var expectedAuthStateChanges = [
        'unauthenticated->authenticated',
        'authenticated->unauthenticated'
      ];
      var authStateChanges = [];
      client.on('authStateChange', function (status) {
        authStateChanges.push(status.oldState + '->' + status.newState);
      });

      assert.equal(client.authState, 'unauthenticated');

      client.once('connect', function (statusA) {
        assert.equal(client.authState, 'authenticated');
        client.authenticate(invalidSignedAuthToken, function (err) {
          assert.notEqual(err, null);
          assert.equal(err.name, 'AuthTokenInvalidError');
          assert.equal(client.authState, 'unauthenticated');
          assert.equal(JSON.stringify(authStateChanges), JSON.stringify(expectedAuthStateChanges));
          done();
        });
        assert.equal(client.authState, 'authenticated');
      });
    });

    it('should go through the correct sequence of authentication state changes when authenticating as a user while already authenticated as another user', function (done) {
      global.localStorage.setItem('socketCluster.authToken', validSignedAuthTokenBob);
      client = socketClusterClient.connect(clientOptions);

      var expectedAuthStateChanges = [
        'unauthenticated->authenticated'
      ];
      var authStateChanges = [];
      client.on('authStateChange', function (status) {
        authStateChanges.push(status.oldState + '->' + status.newState);
      });

      var expectedAuthTokenChanges = [
        validSignedAuthTokenBob,
        validSignedAuthTokenKate
      ];
      var authTokenChanges = [];
      client.on('authTokenChange', function (newSignedAuthToken) {
        authTokenChanges.push(newSignedAuthToken);
      });

      assert.equal(client.authState, 'unauthenticated');

      client.once('connect', function (statusA) {
        assert.equal(client.authState, 'authenticated');
        assert.equal(client.authToken.username, 'bob');
        client.authenticate(validSignedAuthTokenKate, function (err) {
          assert.equal(err, null);
          assert.equal(client.authState, 'authenticated');
          assert.equal(client.authToken.username, 'kate');
          assert.equal(JSON.stringify(authStateChanges), JSON.stringify(expectedAuthStateChanges));
          assert.equal(JSON.stringify(authTokenChanges), JSON.stringify(expectedAuthTokenChanges));
          done();
        });
        assert.equal(client.authState, 'authenticated');
      });
    });

    it('should wait for socket to be authenticated before subscribing to waitForAuth channel', function (done) {
      client = socketClusterClient.connect(clientOptions);
      var privateChannel = client.subscribe('priv', {waitForAuth: true});
      assert.equal(privateChannel.state, 'pending');

      client.once('connect', function (statusA) {
        assert.equal(privateChannel.state, 'pending');
        privateChannel.once('subscribe', function () {
          assert.equal(privateChannel.state, 'subscribed');
          client.once('disconnect', function () {
            assert.equal(privateChannel.state, 'pending');
            privateChannel.once('subscribe', function () {
              assert.equal(privateChannel.state, 'subscribed');
              done();
            });
            client.authenticate(validSignedAuthTokenBob);
          });
          client.disconnect();
        });
        client.emit('login', {username: 'bob'});
      });
    });

    it('subscriptions (including those with waitForAuth option) should have priority over the authenticate action', function (done) {
      global.localStorage.setItem('socketCluster.authToken', validSignedAuthTokenBob);
      client = socketClusterClient.connect(clientOptions);

      var expectedAuthStateChanges = [
        'unauthenticated->authenticated',
        'authenticated->unauthenticated'
      ];
      var authStateChanges = [];
      client.on('authStateChange', function (status) {
        authStateChanges.push(status.oldState + '->' + status.newState);
      });

      client.authenticate(invalidSignedAuthToken, function (err) {
        assert.equal(err.name, 'AuthTokenInvalidError');
      });

      var privateChannel = client.subscribe('priv', {waitForAuth: true});
      assert.equal(privateChannel.state, 'pending');

      client.once('connect', function (statusA) {
        assert.equal(statusA.isAuthenticated, true);
        assert.equal(privateChannel.state, 'pending');
        privateChannel.once('subscribeFail', function (err) {
          // This shouldn't happen because the subscription should be
          // processed before the authenticate() call with the invalid token fails.
          throw new Error('Failed to subscribe to channel: ' + err.message);
        });
        privateChannel.once('subscribe', function (err) {
          assert.equal(privateChannel.state, 'subscribed');
        });
      });

      client.once('deauthenticate', function () {
        // The subscription already went through so it should still be subscribed.
        assert.equal(privateChannel.state, 'subscribed');
        assert.equal(client.authState, 'unauthenticated');

        var privateChannel2 = client.subscribe('priv2', {waitForAuth: true});
        privateChannel2.once('subscribe', function () {
          throw new Error('Should not subscribe because the socket is not authenticated');
        });
      });

      setTimeout(function () {
        client.off('authStateChange');
        assert.equal(JSON.stringify(authStateChanges), JSON.stringify(expectedAuthStateChanges));
        done();
      }, 1000);
    });

    it('should trigger the close event if the socket disconnects in the middle of the handshake phase', function (done) {
      client = socketClusterClient.connect(clientOptions);
      var aborted = false;
      var diconnected = false;
      var closed = false;

      client.on('connectAbort', function () {
        aborted = true;
      });
      client.on('disconnect', function () {
        diconnected = true;
      });
      client.on('close', function () {
        closed = true;
      });

      client.disconnect();

      setTimeout(function () {
        assert.equal(aborted, true);
        assert.equal(diconnected, false);
        assert.equal(closed, true);
        done();
      }, 300);
    });

    it('should trigger the close event if the socket disconnects after the handshake phase', function (done) {
      client = socketClusterClient.connect(clientOptions);
      var aborted = false;
      var diconnected = false;
      var closed = false;

      client.on('connectAbort', function () {
        aborted = true;
      });
      client.on('disconnect', function () {
        diconnected = true;
      });
      client.on('close', function () {
        closed = true;
      });

      client.on('connect', function () {
        client.disconnect();
      });

      setTimeout(function () {
        assert.equal(aborted, false);
        assert.equal(diconnected, true);
        assert.equal(closed, true);
        done();
      }, 300);
    });
  });

  describe('emitting events', function () {
    it('should not throw error on socket if ackTimeout elapses before response to event is sent back', function (done) {
      client = socketClusterClient.connect(clientOptions);

      var caughtError;

      var clientError;
      client.on('error', function (err) {
        clientError = err;
      });

      var responseError;

      client.on('connect', function () {
        client.emit('performTask', 123, function (err) {
          responseError = err;
        });
        setTimeout(function () {
          try {
            client.disconnect();
          } catch (e) {
            caughtError = e;
          }
        }, 250);
      });

      setTimeout(function () {
        assert.notEqual(responseError, null);
        assert.equal(caughtError, null);
        done();
      }, 300);
    });
  });
});
