#!/usr/bin/env bash
# Déploiement en une commande DEPUIS TA MACHINE : commit + push git, puis mise à jour du VPS.
# Usage :  VPS=root@1.2.3.4 ./deploy/deploy.sh "message de commit"
set -e
: "${VPS:?Définis VPS, ex: VPS=root@1.2.3.4 ./deploy/deploy.sh \"mon message\"}"
MSG="${1:-maj}"

echo ">> commit + push git"
git add -A
git commit -m "$MSG" || echo "(rien à committer)"
git push

echo ">> mise à jour du VPS ($VPS) via git pull + restart"
ssh "$VPS" "git config --global --add safe.directory /opt/valotiz/app 2>/dev/null || true; cd /opt/valotiz/app && git pull --ff-only && chown -R valotiz:valotiz /opt/valotiz/app && (systemctl restart valotiz-ws valotiz-web 2>/dev/null || true) && (systemctl reload nginx 2>/dev/null || true) && echo OK"

echo ">> Terminé."
