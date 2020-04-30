#!/bin/bash

s=$(/usr/bin/wait_on_lnd.sh)
echo $s
if [[ $s != *"synced_to_chain"* ]]
then
        exit 1
fi
containerExists=$(docker inspect --format={{.Name}} shocknet_api)
if [[ $containerExists != "/shocknet_api" ]]
then 
        ipAddr=$(ip -o route get to 8.8.8.8 | sed -n 's/.*src \([0-9.]\+\).*/\1/p'):10009
        if ! docker create --name shocknet_api -e LND_ADDR="$ipAddr" -p 9835:9835 shocknet_api_img:1
        then 
                exit 1
        fi
        exit 0
fi

containerStatus=$(docker inspect --format={{.State.Running}} shocknet_api)
#echo $containerStatus
if [[ $containerStatus == "true" ]]
then
        echo ok
else
        
        if ! docker cp /home/bitcoin/.lnd/tls.cert shocknet_api:/usr/src/app/tls.cert
        then
                exit 1
        fi
        if ! docker cp /home/bitcoin/.lnd/data/chain/bitcoin/mainnet/admin.macaroon shocknet_api:/usr/src/app/admin.macaroon
        then
                exit 1
        fi
        if ! docker start shocknet_api
        then
                exit 1
        fi
fi