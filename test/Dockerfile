FROM alpine:latest

# 1. SSHサーバーのインストールと、起動に必要なホスト鍵の自動生成
RUN apk add --no-cache openssh \
    && ssh-keygen -A

# 2. SSHDの絶対ルールを書き換え（空パスワードOK、rootログインOK、PAM不使用）
RUN sed -i 's/#PermitEmptyPasswords.*/PermitEmptyPasswords yes/' /etc/ssh/sshd_config \
    && sed -i 's/#PermitRootLogin.*/PermitRootLogin yes/' /etc/ssh/sshd_config \
    && sed -i 's/#UsePAM.*/UsePAM no/' /etc/ssh/sshd_config

# 3. rootユーザーのパスワードを完全に削除（ロック解除状態の空っぽにする）
RUN passwd -d root

# 4. 22番ポートを開け、デーモンとして起動
EXPOSE 22
CMD ["/usr/sbin/sshd", "-D"]