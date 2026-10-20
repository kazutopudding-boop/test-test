apt update
apt install -y sshpass nginx php php-fpm certbot python3-certbot-nginx

systemctl stop apache2
systemctl disable apache2

nginx -t
systemctl restart nginx
systemctl reload nginx
systemctl status nginx

git clone https://github.com/GitHub30/OpenCloudShell
vi /etc/nginx/sites-available/default
vi /etc/default/ttyd
systemctl restart ttyd

certbot --nginx -d opencloudshell.com -d www.opencloudshell.com