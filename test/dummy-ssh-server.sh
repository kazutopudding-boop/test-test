if [ ! -f dummy.key ]; then
    ssh-keygen -t ed25519 -f dummy.key -q -N ""
    chmod 600 dummy.key
fi
# if not use 10022 port. then docker run
if ! docker ps --format '{{.Ports}}' | grep -q 10022; then
    docker run -d -p 10022:2222 -e SUDO_ACCESS=true -e PUBLIC_KEY="$(cat dummy.key.pub)" linuxserver/openssh-server
    # echo "export PS1='\[\033[01;32m\]\u@\h\[\033[00m\]:\[\033[01;34m\]\w\[\033[00m\]\$ '" >> ~/.profile
fi

# ssh -o LogLevel=ERROR -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -i dummy.key -p 10022 linuxserver.io@localhost

# ssh -o LogLevel=ERROR -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -p 443 -R0:localhost:10022 tcp@a.pinggy.io
# ssh -o LogLevel=ERROR -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -i dummy.key -p 33567 linuxserver.io@ubxxe-23-97-62-139.run.pinggy-free.link

# Password Auth
# docker run -d -p 10025:2222 -e SUDO_ACCESS=true -e PASSWORD_ACCESS=true -e USER_PASSWORD=passwd linuxserver/openssh-server
# ssh -o LogLevel=ERROR -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -p 10025 linuxserver.io@localhost
# ssh -o LogLevel=ERROR -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -p 443 -R0:localhost:10025 tcp@a.pinggy.io
# ssh -o LogLevel=ERROR -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -p 33567 linuxserver.io@ubxxe-23-97-62-139.run.pinggy-free.link

# Key with Passphrase
# ssh-keygen -t ed25519 -f passphrase.key -q -N "passphrase"
# chmod 600 passphrase.key
# docker run -d -p 10026:2222 -e SUDO_ACCESS=true -e PUBLIC_KEY="$(cat passphrase.key.pub)" linuxserver/openssh-server
# ssh -o LogLevel=ERROR -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -i passphrase.key -p 10026 linuxserver.io@localhost
# sshpass -P passphrase -p "passphrase" ssh -o LogLevel=ERROR -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -i passphrase.key -p 10026 linuxserver.io@localhost
# ssh -o LogLevel=ERROR -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -p 443 -R0:localhost:10026 tcp@a.pinggy.io
# ssh -o LogLevel=ERROR -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -i passphrase.key -p 33567 linuxserver.io@ubxxe-23-97-62-139.run.pinggy-free.link

# No Password and No Key
# docker build -t my-ssh-server .
# docker run -d --name test-ssh -p 10027:22 my-ssh-server
# ssh -o LogLevel=ERROR -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -p 10027 root@localhost
# ssh -o LogLevel=ERROR -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -p 443 -R0:localhost:10027 tcp@a.pinggy.io
# ssh -o LogLevel=ERROR -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -p 33567 root@ubxxe-23-97-62-139.run.pinggy-free.link
