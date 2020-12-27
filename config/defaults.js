const os = require("os");
const path = require("path");
const platform = os.platform();
const homeDir = os.homedir();

const getLndDirectory = () => {
  if (platform === "darwin") {
    return homeDir + "/Library/Application Support/Lnd";
  } else if (platform === "win32") {
    // eslint-disable-next-line no-process-env
    const { APPDATA = "" } = process.env;
    return path.resolve(APPDATA, "../Local/Lnd");
  }

  return homeDir + "/.lnd";
};

const getLoopDirectory = () => {
  if (platform === "darwin") {
    return homeDir + "/Library/Application Support/Loop";
  } else if (platform === "win32") {
    // eslint-disable-next-line no-process-env
    const { APPDATA = "" } = process.env;
    return path.resolve(APPDATA, "../Local/Loop");
  }

  return homeDir + "/.loop";
};

const parsePath = (filePath = "") => {
  if (platform === "win32") {
    return filePath.replace("/", "\\");
  }

  return filePath;
};

const lndDirectory = getLndDirectory();
const loopDirectory = getLoopDirectory();

module.exports = (mainnet = false) => {
  const network = mainnet ? "mainnet" : "testnet";

  return {
    serverPort: 9835,
    serverHost: "localhost",
    lndAddress: "127.0.0.1:9735",
    maxNumRoutesToQuery: 20,
    lndProto: parsePath(`${__dirname}/rpc.proto`),
    routerProto: parsePath(`${__dirname}/router.proto`),
    invoicesProto: parsePath(`${__dirname}/invoices.proto`),
    walletUnlockerProto: parsePath(`${__dirname}/walletunlocker.proto`),
    loopClientProto: parsePath(`${__dirname}/loopClient.proto`),
    chainnotifierProto: parsePath(`${__dirname}/chainnotifier.proto`),
    lndHost: "localhost:10009",
    lndCertPath: parsePath(`${lndDirectory}/tls.cert`),
    macaroonPath: parsePath(
      `${lndDirectory}/data/chain/bitcoin/${network}/admin.macaroon`
    ),
    loopEnabled:false,
    loopHost: "localhost:11010",
    loopCertPath: parsePath(`${loopDirectory}/${network}/tls.cert`),
    loopMacaroonPath: parsePath(
      `${loopDirectory}/${network}/loop.macaroon`
    ),
    dataPath: parsePath(`${lndDirectory}/data`),
    loglevel: "info",
    logfile: "shockapi.log",
    lndLogFile: parsePath(`${lndDirectory}/logs/bitcoin/${network}/lnd.log`),
    lndDirPath: lndDirectory,
    peers: ['https://gun.shock.network:8765/gun'],
    useTLS: false,
    tokenExpirationMS: 259200000
  };
};
