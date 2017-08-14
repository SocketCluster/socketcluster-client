/*
|-------------------------------------------------
|	Socketcluster-Client Promise Tester
|-------------------------------------------------
|
|	This file tests the new Promise 
|	functionality in SC.
|
|	I thought about using ASYNC or Async/Await
|	but then I would have to import a package
|	that is unnecessary for anything other than
|	testing or in the case of Async/Await would
|	require Node 8 to test... so I kept it
|	simple.
|
*/

var socketClusterServer = require('socketcluster-server');
var socketClusterClient = require('../');

var PORT = 8008;

var clientOptions = {
  hostname: '127.0.0.1',
  port: PORT,
  multiplex: false,
  usePromises:true
};

var serverOptions = {
  authKey: 'testkey'
};

var server, client;

server = socketClusterServer.listen(PORT, serverOptions);

server.on('connection',function(socket) {
	console.log('SERVER >> Client',socket.id,'connected')

	// Testing regular data
	socket.on('TEST1',function(data,respond) {
		respond(null,{id:2})
	})

	socket.on('TEST2',function(data,respond) {
		respond(null,{id:4})
	})

})

server.on('ready', function () {
  client = socketClusterClient.connect(clientOptions);

  client.on('connect',function() {
  	console.log('CLIENT >> connected')

  	console.log('TEST1 >> Checking emit basic promise functionality')
  	client.emit('TEST1',{id:1})
  		.then(data => {
  			console.log('CLIENT >> Response:')
  			console.log(data)
  			console.log('CLIENT >> TEST1 Successful')

  			console.log('\nTEST2 >> Checking emit standard callback functionality')
  			client.emit('TEST2',{id:3},function(err,data) {
  				if (err) {
  					return console.log('CLIENT >> Received error in TEST2... this should NOT happen. Callback test failed in TEST2.')
  				}

	  			console.log('CLIENT >> Response:')
	  			console.log(data)
	  			console.log('CLIENT >> TEST2 Successful')

	  			console.log('\n\nCLIENT >> Promise test SUCCESSFUL!!\n\n')
  			})
  		})
  		.catch(err => {
  			console.log(err)
  			console.log('CLIENT >> Received error in TEST1... this should NOT happen. Promise test failed in TEST1.')
  		})

  })
});