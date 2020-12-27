const Path = require("path");
const grpc = require("@grpc/grpc-js");
const protoLoader = require("@grpc/proto-loader");
const logger = require("winston");
const fs = require("../../utils/fs");
const errorConstants = require("../../constants/errors");

// expose the routes to our app with module.exports
/**
 * @typedef LightningConfig
 * @prop {string} lnrpcProtoPath
 * @prop {string} routerProtoPath
 * @prop {string} invoicesProtoPath
 * @prop {string} walletUnlockerProtoPath
 * @prop {string} loopClientProtoPath
 * @prop {string} chainnotifierProtoPath
 * @prop {string} lndHost
 * @prop {string} lndCertPath
 * @prop {string?} macaroonPath
 * @prop {boolean} loopEnabled
 * @prop {string} loopHost
 * @prop {string} loopCertPath
 * @prop {string?} loopMacaroonPath
 */

/** 
 * @typedef LightningServices
 * @prop {any} lightning
 * @prop {any} walletUnlocker
 * @prop {any} router
 * @prop {any} chainNotifier
 * @prop {any=} swapClient
 * @prop {any} invoices
 */

/** 
 * @param {LightningConfig} args0
 * @returns {Promise<LightningServices>}
 */
module.exports = async ({
  lnrpcProtoPath,
  routerProtoPath,
  invoicesProtoPath,
  walletUnlockerProtoPath,
  loopClientProtoPath,
  chainnotifierProtoPath,
  lndHost,
  lndCertPath,
  macaroonPath,
  loopEnabled,
  loopHost,
  loopCertPath,
  loopMacaroonPath
}) => {
  try {
    process.env.GRPC_SSL_CIPHER_SUITES = "HIGH+ECDSA";
    const protoLoaderConfig = {
      keepCase: true,
      longs: String,
      enums: String,
      defaults: true,
      oneofs: true,
      includeDirs: ["node_modules/google-proto-files", "proto", Path.resolve(__dirname, "../../config")]
    }

    const [
      lnrpcProto,
      routerProto,
      walletUnlockerProto,
      chainnotifierProto,
      looprpcProto,
      invoicesProto
    ] = await Promise.all([
      protoLoader.load(lnrpcProtoPath, protoLoaderConfig),
      protoLoader.load(routerProtoPath, protoLoaderConfig),
      protoLoader.load(walletUnlockerProtoPath, protoLoaderConfig),
      protoLoader.load(chainnotifierProtoPath, protoLoaderConfig),
      protoLoader.load(loopClientProtoPath, protoLoaderConfig),
      protoLoader.load(invoicesProtoPath, protoLoaderConfig)
    ]);
    const { lnrpc } = grpc.loadPackageDefinition(lnrpcProto);
    const { routerrpc } = grpc.loadPackageDefinition(routerProto);
    const { invoicesrpc } = grpc.loadPackageDefinition(invoicesProto);
    const { lnrpc: walletunlockerrpc } = grpc.loadPackageDefinition(walletUnlockerProto);
    const { looprpc } = grpc.loadPackageDefinition(looprpcProto);
    const { chainrpc } = grpc.loadPackageDefinition(chainnotifierProto);

    /**
     * 
     * @param {string} CertFilePath 
     * @param {string|null} macaroonFilePath 
     */
    const getCredentials = async (CertFilePath, macaroonFilePath) => {
      const tlsCert = await fs.readFile(CertFilePath);
      const sslCreds = grpc.credentials.createSsl(tlsCert);

      if (macaroonFilePath) {
        const macaroonExists = await fs.access(macaroonFilePath);

        if (macaroonExists) {
          const macaroonCreds = grpc.credentials.createFromMetadataGenerator(
            async (_, callback) => {
              const macaroonFileData = await fs.readFile(macaroonFilePath);
              const metadata = new grpc.Metadata();
              metadata.add("macaroon", macaroonFileData.toString("hex"));
              callback(null, metadata);
            }
          );
          return grpc.credentials.combineChannelCredentials(
            sslCreds,
            macaroonCreds
          );
        }

        const error = errorConstants.MACAROON_PATH(macaroonFilePath);
        logger.error(error);
        throw error;
      } else {
        return sslCreds;
      }
    };

    if (lndCertPath) {
      const certExists = await fs.access(lndCertPath);
      const loopCertExists = loopEnabled && await fs.access(loopCertPath)

      if (certExists) {
        const credentials = await getCredentials(lndCertPath, macaroonPath);


        // @ts-ignore
        const lightning = new lnrpc.Lightning(lndHost, credentials);
        // @ts-ignore
        const walletUnlocker = new walletunlockerrpc.WalletUnlocker(lndHost, credentials);
        // @ts-ignore
        const router = new routerrpc.Router(lndHost, credentials);
        // @ts-ignore
        const chainNotifier = new chainrpc.ChainNotifier(lndHost, credentials);
        // @ts-ignore
        const invoices = new invoicesrpc.Invoices(lndHost, credentials);

        /**
         * @type {LightningServices}
         */
        const services = {
          lightning,
          walletUnlocker,
          router,
          chainNotifier,
          invoices
        }

        if (loopCertExists) {
          const loopCredentials = await getCredentials(loopCertPath, loopMacaroonPath)
          // @ts-ignore
          const swapClient = new looprpc.SwapClient(loopHost, loopCredentials);
          services.swapClient = swapClient
        }

        return services
      }

      const error = errorConstants.CERT_PATH(lndCertPath);
      logger.error(error);
      throw error;
    } else {
      const error = errorConstants.CERT_AND_MACAROON_MISSING(macaroonPath, lndCertPath);
      logger.error(error);
      throw error;
    }
  } catch (err) {
    logger.error(err);
    if (err.code === 14) {
      throw {
        field: "unknown",
        message:
          "Failed to connect to LND server, make sure it's up and running."
      };
    }
    throw err;
  }
};
