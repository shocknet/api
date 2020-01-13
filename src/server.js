"use strict";

/**
 * Module dependencies.
 */
const server = program => {
  const Https = require("https");
  const Http = require("http");
  const Express = require("express");
  const LightningServices = require("../utils/lightningServices");
  const app = Express();
  
  const FS = require("../utils/fs");
  const bodyParser = require("body-parser");
  const session = require("express-session");
  const methodOverride = require("method-override");
  const { unprotectedRoutes, sensitiveRoutes } = require("../utils/protectedRoutes");
  // load app default configuration data
  const defaults = require("../config/defaults")(program.mainnet);
  // define useful global variables ======================================
  module.useTLS = program.usetls;
  module.serverPort = program.serverport || defaults.serverPort;
  module.httpsPort = module.serverPort;
  module.serverHost = program.serverhost || defaults.serverHost;

  // setup winston logging ==========
  const logger = require("../config/log")(
    program.logfile || defaults.logfile,
    program.loglevel || defaults.loglevel
  );

  // utilities functions =================
  require("../utils/server-utils")(module);

  logger.info("Mainnet Mode:", !!program.mainnet);

  const wait = seconds =>
    new Promise(resolve => {
      const timer = setTimeout(() => resolve(timer), seconds * 1000);
    });

  // eslint-disable-next-line consistent-return
  const startServer = async () => {
    try {
      LightningServices.setDefaults(program);
      await LightningServices.init();

      // init lnd module =================
      const lnd = require("../services/lnd/lnd")(LightningServices.services.lightning);
      const auth = require("../services/auth/auth");

      app.use(async (req, res, next) => {
        console.log("Route:", req.path)
        if (unprotectedRoutes[req.method][req.path]) {
          next();
        } else {
          try {
            const response = await auth.validateToken(
              req.headers.authorization.replace("Bearer ", "")
            );
            if (response.valid) {
              next();
            } else {
              res.status(401).json({ field: "authorization", errorMessage: "The authorization token you've supplied is invalid" });
            }
          } catch (err) {
            logger.error(
              !req.headers.authorization 
                ? "Please add an Authorization header" 
                : err
            );
            res.status(401).json({ field: "authorization", errorMessage: "Please log in" });
          }
        }
      });

      app.use((req, res, next) => {
        if (sensitiveRoutes[req.method][req.path]) {
          console.log(
            JSON.stringify({
              time: new Date(),
              ip: req.ip,
              method: req.method,
              path: req.path,
              sessionId: req.sessionId
            })
          );
        } else {
          console.log(
            JSON.stringify({
              time: new Date(),
              ip: req.ip,
              method: req.method,
              path: req.path,
              body: req.body,
              query: req.query,
              sessionId: req.sessionId
            })
          );
        }
        next();
      });
      app.use(
        session({
          secret: defaults.sessionSecret,
          cookie: { maxAge: defaults.sessionMaxAge },
          resave: true,
          rolling: true,
          saveUninitialized: true
        })
      );
      app.use(bodyParser.urlencoded({ extended: "true" }));
      app.use(bodyParser.json());
      app.use(bodyParser.json({ type: "application/vnd.api+json" }));
      app.use(methodOverride());
      // WARNING
      // error handler middleware, KEEP 4 parameters as express detects the
      // arity of the function to treat it as a err handling middleware
      // eslint-disable-next-line no-unused-vars
      app.use((err, _, res, __) => {
        // Do logging and user-friendly error message display
        logger.error(err);
        res
          .status(500)
          .send({ status: 500, errorMessage: "internal error" });
      });

      const CA = LightningServices.servicesConfig.lndCertPath
      const CA_KEY = CA.replace("cert", "key")

      const createServer = async () => {
        try {
          if (LightningServices.servicesConfig.lndCertPath && program.usetls) {
            const [key, cert] = await Promise.all([
              FS.readFile(CA_KEY),
              FS.readFile(CA)
            ]);
            const httpsServer = Https.createServer({ key, cert }, app);

            return httpsServer;
          }

          const httpServer = Http.Server(app);
          return httpServer;
        } catch (err) {
          logger.error(err.message);
          logger.error("An error has occurred while finding an LND cert to use to open an HTTPS server")
          logger.warn("Falling back to opening an HTTP server...")
          const httpServer = Http.Server(app);
          return httpServer
        }
      };

      const serverInstance = await createServer();

      const io = require("socket.io")(serverInstance);

      const Sockets = require("./sockets")(
        io,
        lnd,
        program.user,
        program.pwd,
        program.limituser,
        program.limitpwd
      );

      require("./routes")(
        app,
        defaults,
        Sockets,
        {
          serverHost: module.serverHost,
          serverPort: module.serverPort,
          usetls: program.usetls,
          CA,
          CA_KEY
        }
      );

      // enable CORS headers
      app.use(require("./cors"));
      // app.use(bodyParser.json({limit: '100000mb'}));
      app.use(bodyParser.json({ limit: "50mb" }));
      app.use(bodyParser.urlencoded({ limit: "50mb", extended: true }));

      serverInstance.listen(module.serverPort, module.serverhost);

      logger.info(
        "App listening on " + module.serverHost + " port " + module.serverPort
      );

      module.server = serverInstance;

      // const localtunnel = require('localtunnel');
      //
      // const tunnel = localtunnel(port, (err, t) => {
      // 	console.log('err', err);
      // 	console.log('t', t.url);
      // });
    } catch (err) {
      logger.info(err);
      logger.info("Restarting server in 30 seconds...");
      await wait(30);
      startServer();
      return false;
    }
  };

  startServer();
};

module.exports = server;
