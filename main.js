const program = require("commander");

const {version} = (JSON.parse(require('fs').readFileSync("./package.json", "utf-8")))

// parse command line parameters
program
	.version(version)
	.option("-s, --serverport [port]", "web server http listening port (defaults to 9835)")
	.option("-h, --serverhost [host]", "web server listening host (defaults to localhost)")
	.option("-l, --lndhost [host:port]", "RPC lnd host (defaults to localhost:10009)")
	.option("-u, --user [login]", "basic authentication login")
	.option("-p, --pwd [password]", "basic authentication password")
	.option("-m, --macaroon-path [file path]", "path to admin.macaroon file")
	.option("-d, --lnd-cert-path [file path]", "path to LND cert file")
	.option("-f, --logfile [file path]", "path to file where to store the application logs")
	.option("-e, --loglevel [level]", "level of logs to display (debug, info, warn, error)")
	.option("-k, --le-email [email]", "lets encrypt required contact email")
	.option("-c, --mainnet", "run server on mainnet mode")
	.option("-t, --tunnel","create a localtunnel to listen behind a firewall")
	.option('-r, --lndaddress', 'Lnd address, defaults to 127.0.0.1:9735')
	.option('-a, --use-TLS', 'use TLS')
	.option('-i, --https-cert [path]', 'HTTPS certificate path')
	.option('-y, --https-cert-key [path]', 'HTTPS certificate key path')
	.parse(process.argv);

// load server
require("./src/server")(program); // Standard server version
