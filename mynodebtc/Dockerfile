FROM node:12

WORKDIR /usr/src/app

ADD ./start.sh /start.sh



#RUN useradd app && \
#    mkdir -p /home/app/.lnd

RUN apt-get update && \
        apt-get install -y --no-install-recommends git && \
        git clone --single-branch --branch mynodebtc https://github.com/shocknet/api.git /usr/src/app && \
        yarn install --network-timeout 1000000 && \
        apt-get remove -y git && \
        rm -rf /var/lib/apt/lists/*

#ADD ./tls.cert /usr/src/app/tls.cert
#ADD ./admin.macaroon /usr/src/app/admin.macaroon

RUN chmod +x /start.sh
# && \
#    chown -R app:app /home/app && \
#    chown -R app:app /usr/src/app && \
#    chown -R app:app /start.sh

#ARG lnd_address
#ENV LND_ADDR=$lnd_address

CMD ["/start.sh"]