#!/bin/bash

while true
do
        sleep 1m


        pingRes=$(curl -m 5 localhost:9835/ping | jq '.message')
        echo $pingRes
        if [[ $pingRes == \"OK\" ]]
        then
                echo ok
        else
                exit 1
        fi

done