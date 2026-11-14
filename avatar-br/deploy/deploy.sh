#!/usr/bin/env bash
# Mise a jour du jeu sur le VPS via SCP, puis redemarrage des services.
# Usage :  VPS=root@1.2.3.4 ./deploy/deploy.sh
set -e
: "${VPS:?Definis VPS, ex: VPS=root@1.2.3.4 ./deploy/deploy.sh}"
DEST=/opt/valotiz/app
echo ">> Envoi des fichiers vers $VPS:$DEST"
# -O = ancien protocole scp (compatible), -r recursif ; on envoie tout le projet sauf caches
rsync -az --delete --exclude node_modules --exclude '.cache' ./ "$VPS:$DEST/" 2>/dev/null \
  || scp -r ./fps ./index.html ./server.mjs ./serve.mjs ./avatars "$VPS:$DEST/"
echo ">> Droits + redemarrage"
ssh "$VPS" "chown -R valotiz:valotiz $DEST && systemctl restart valotiz-ws valotiz-web 2>/dev/null; systemctl restart valotiz-ws nginx 2>/dev/null; echo OK"
echo ">> Termine."
