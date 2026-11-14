# Déployer VALOTIZ sur un VPS Debian (neuf)

Deux processus Node : le **serveur WebSocket** (`server.mjs`, temps réel) et le **serveur web** (`serve.mjs`, fichiers).
Tout est en **Node pur, sans dépendance**. Deux options : **A) HTTP direct par IP** (le plus rapide) ou **B) domaine + HTTPS/wss** (propre, recommandé pour jouer entre amis).

Le client choisit automatiquement : en **HTTPS** il se connecte en `wss://<host>/ws` (option B, via nginx) ; sinon en `ws://<host>:8091` (option A).

---

## 1. Préparer le VPS (en root)

```bash
apt update && apt upgrade -y
apt install -y curl git rsync ufw

# Node.js 20 LTS
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs
node -v   # doit afficher v20.x

# Utilisateur de service dédié + dossier de l'app
adduser --system --group --home /opt/valotiz valotiz
mkdir -p /opt/valotiz/app
```

## 2. Envoyer le projet (depuis TA machine, pas le VPS)

Depuis le dossier qui contient `avatar-br/` :

```bash
# remplace root@IP par ton VPS
rsync -az --exclude node_modules --exclude .cache ./avatar-br/ root@IP:/opt/valotiz/app/
# (si pas de rsync :  scp -r ./avatar-br/* root@IP:/opt/valotiz/app/ )
```

Puis sur le VPS :

```bash
chown -R valotiz:valotiz /opt/valotiz
```

---

## Option A — HTTP direct par IP (rapide, sans domaine)

Les joueurs iront sur `http://IP_DU_VPS:8090`.

```bash
# Services systemd (fichiers fournis dans deploy/)
cp /opt/valotiz/app/deploy/valotiz-ws.service  /etc/systemd/system/
cp /opt/valotiz/app/deploy/valotiz-web.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now valotiz-ws valotiz-web
systemctl status valotiz-ws valotiz-web --no-pager

# Pare-feu
ufw allow OpenSSH
ufw allow 8090/tcp
ufw allow 8091/tcp
ufw --force enable
```

→ Ouvre `http://IP_DU_VPS:8090`, clique **5v5 EN LIGNE**. Le 1er connecté est l'hôte.

---

## Option B — Domaine + HTTPS (wss), recommandé

nginx sert les fichiers et proxifie `/ws` vers le serveur WebSocket. On ne lance que `valotiz-ws`.

```bash
apt install -y nginx certbot python3-certbot-nginx

# Service WebSocket seulement
cp /opt/valotiz/app/deploy/valotiz-ws.service /etc/systemd/system/
systemctl daemon-reload && systemctl enable --now valotiz-ws

# Config nginx (édite d'abord server_name dans le fichier)
cp /opt/valotiz/app/deploy/nginx-valotiz.conf /etc/nginx/sites-available/valotiz
nano /etc/nginx/sites-available/valotiz          # mets ton domaine
ln -s /etc/nginx/sites-available/valotiz /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

# Pare-feu
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw --force enable

# Certificat TLS (fais pointer ton domaine A -> IP du VPS avant)
certbot --nginx -d valotiz.ton-domaine.com
```

→ Ouvre `https://valotiz.ton-domaine.com`. Le client passe tout seul en `wss://.../ws`.
(En option B, laisse le port 8091 fermé au public : nginx y accède en local.)

---

## 3. Mettre à jour plus tard (SCP)

Après avoir modifié le jeu en local :

```bash
# tout le projet + redémarrage automatique
VPS=root@IP ./avatar-br/deploy/deploy.sh

# ou juste le fichier de jeu :
scp ./avatar-br/fps/index.html root@IP:/opt/valotiz/app/fps/index.html
ssh root@IP 'systemctl restart valotiz-ws valotiz-web'   # option A
# ssh root@IP 'systemctl restart valotiz-ws && systemctl reload nginx'   # option B
```

## Logs / dépannage

```bash
journalctl -u valotiz-ws  -f      # serveur temps réel
journalctl -u valotiz-web -f      # serveur web (option A)
systemctl restart valotiz-ws      # redémarrer
```

- Port WS configurable : `Environment=WS_PORT=9000` dans le service (et `proxy_pass ...:9000` côté nginx).
- Vérifie que les ports du cloud provider (Security Group / pare-feu externe) sont aussi ouverts (22, 80, 443, et 8090/8091 en option A).
