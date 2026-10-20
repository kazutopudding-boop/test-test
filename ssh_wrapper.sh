#!/bin/bash

id="$1"
filename="/tmp/$id.json"

ssh_options=()

port=$(jq -r '.port // empty' $filename 2> /dev/null)
if [ -n "$port" ]; then
    ssh_options+=(-p $port)
fi

key=$(jq -r '.key // empty' $filename 2> /dev/null)
if [ -n "$key" ]; then
    TMP_KEY=$(mktemp)
    echo "$key" > $TMP_KEY
    chmod 600 "$TMP_KEY"
    ssh_options+=(-i $TMP_KEY)
fi

password=$(jq -r '.password // empty' $filename 2> /dev/null)
if [ -n "$password" ]; then
    TMP_PASS=$(mktemp)
    echo "$password" > $TMP_PASS
    if [ -n "$key" ]; then
        sshpass_command="sshpass -P passphrase -f $TMP_PASS"
    else
        sshpass_command="sshpass -f $TMP_PASS"
    fi
fi


destination=$(jq -r '.destination // empty' $filename 2> /dev/null)

exec $sshpass_command ssh -o LogLevel=ERROR -o ServerAliveInterval=60 -o ConnectTimeout=5 -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null "${ssh_options[@]}" "$destination"
