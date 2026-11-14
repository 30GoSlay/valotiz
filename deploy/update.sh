#!/usr/bin/env bash
# Mise à jour du jeu sur le VPS depuis git, puis redémarrage des services.
# À lancer SUR LE VPS (en root), dans n'importe quel dossier :
#   /opt/valotiz/app/deploy/update.sh
set -e
APP=/opt/valotiz/app

echo ">> git pull dans $APP"
cd "$APP"
git pull --ff-only

echo ">> droits"
chown -R valotiz:valotiz "$APP"

echo ">> redémarrage des services"
# option A (HTTP/IP) : les deux services
systemctl restart valotiz-ws valotiz-web 2>/dev/null || true
# option B (nginx) : le service WS + reload nginx (ignore si non installé)
systemctl restart valotiz-ws 2>/dev/null || true
systemctl reload nginx 2>/dev/null || true

echo ">> OK — mise à jour terminée."
