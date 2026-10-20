if ! command -v ttyd &> /dev/null; then
    echo "ttyd not found, installing..."
    sudo apt update
    sudo apt install -y ttyd sshpass
fi

if [ ! -x ssh_wrapper.sh ]; then
    chmod +x ssh_wrapper.sh
fi

ttyd -W --max-clients 30 -t titleFixed=OpenCloudShell -t enableZmodem=true -t enableTrzsz=true -t enableSixel=true -t disableReconnect=true -a ./ssh_wrapper.sh
# nano /etc/default/ttyd
# systemctl restart ttyd
# systemctl status ttyd
# Show realtime logs
# journalctl -u ttyd -f