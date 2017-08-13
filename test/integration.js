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
  multiplex: false
};

var serverOptions = {
  authKey: 'testkey'
};

var allowedUsers = {
  bob: true,
  alice: true
};

var server, client;
var validSignedAuthToken;
var invalidSignedAuthToken = 'fakebGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.fakec2VybmFtZSI6ImJvYiIsImlhdCI6MTUwMjYyNTIxMywiZXhwIjoxNTAyNzExNjEzfQ.fakemYcOOjM9bzmS4UYRvlWSk_lm3WGHvclmFjLbyOk';

var connectionHandler = function (socket) {
  socket.once('login', function (userDetails, respond) {
    if (allowedUsers[userDetails.username]) {
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
      var tempClient = socketClusterClient.connect(clientOptions);
      tempClient.once('authenticate', function (signedAuthToken) {
        validSignedAuthToken = signedAuthToken;
        tempClient.once('disconnect', function () {
          done();
        });
        tempClient.destroy();
      });
      tempClient.emit('login', {username: 'bob'});
    });
  });

  after('shut down server afterwards', function (done) {
    server.close();
    done();
  });

  afterEach('shut down client after each test', function (done) {
    global.localStorage.removeItem('socketCluster.authToken');
    if (client) {
      client.once('disconnect', function () {
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
      global.localStorage.setItem('socketCluster.authToken', validSignedAuthToken);
      client = socketClusterClient.connect(clientOptions);
      client.once('connect', function (statusA) {
        assert.equal(client.authState, 'authenticated');
        assert.equal(statusA.isAuthenticated, true);
        assert.equal(statusA.authError === undefined, true);
        done();
      });
    });

    it('should send back error if JWT is invalid during handshake', function (done) {
      client = socketClusterClient.connect(clientOptions);
      client.emit('login', {username: 'bob'});
      client.once('connect', function (statusA) {
        // Change the setAuthKey to invalidate the current token.
        client.emit('setAuthKey', 'differentAuthKey', function (err) {
          assert.equal(err == null, true);

          client.once('disconnect', function () {
            client.once('connect', function (statusB) {

              assert.equal(statusB.isAuthenticated, false);
              assert.notEqual(statusB.authError, null);
              assert.equal(statusB.authError.name, 'AuthTokenInvalidError');
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

    it('after disconnecting while being authenticated, socket should be put in pending authState and then switch to authenticated state after invoking authenticate method with a valid signed auth token', function (done) {
      client = socketClusterClient.connect(clientOptions);

      var expectedAuthStateChanges = [
        'unauthenticated->authenticated',
        'authenticated->unauthenticated',
        'unauthenticated->authenticated'
      ];
      var authStateChanges = [];
      client.on('authStateChange', function (status) {
        authStateChanges.push(status.oldState + '->' + status.newState);
      });

      client.once('connect', function (statusA) {
        client.once('authenticate', function (newSignedToken) {
          client.once('disconnect', function () {
            client.once('authenticate', function (newSignedToken) {
              assert.equal(client.authState, 'authenticated');
              assert.equal(JSON.stringify(authStateChanges), JSON.stringify(expectedAuthStateChanges));
              client.off('authStateChange');
              done();
            });
            assert.equal(client.authState, 'unauthenticated');
            client.authenticate(newSignedToken);
            assert.equal(client.authState, 'unauthenticated');
          });
          assert.equal(client.authState, 'authenticated');
          client.disconnect();
          assert.equal(client.authState, 'unauthenticated');
        });
        assert.equal(client.authState, 'unauthenticated');
        client.emit('login', {username: 'bob'});
        assert.equal(client.authState, 'unauthenticated');
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
            client.authenticate(validSignedAuthToken);
          });
          client.disconnect();
        });
        client.emit('login', {username: 'bob'});
      });
    });

    it('subscriptions (including those with waitForAuth option) should have priority over the authenticate action', function (done) {
      global.localStorage.setItem('socketCluster.authToken', validSignedAuthToken);
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

  });
});
