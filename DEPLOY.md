# Déployer VALOTIZ sur un VPS Debian — avec git

Flux : **ta machine → GitHub → VPS** (`git clone` puis `git pull` pour les mises à jour).

Deux processus Node servent le jeu : le **serveur WebSocket** (`server.mjs`, temps réel) et le **serveur web**
(`serve.mjs`, fichiers). Les deux sont en **Node pur, sans dépendance** — **pas besoin de `npm install` pour jouer**.
(`npm install` ne sert qu'à *régénérer* les avatars, voir le README.)

---

## 1. Pousser le projet sur ton repo (depuis TA machine, une seule fois)

Dans le dossier du projet (celui qui contient `fps/`, `server.mjs`, …) :

```bash
git init                                   # si ce n'est pas déjà un repo
git add -A
git commit -m "VALOTIZ"
git branch -M main
git remote add origin https://github.com/<TON-PSEUDO>/valotiz.git
git push -u origin main
```

> Le gros fichier `fps/models/kuronami.glb` (~15 Mo) passe sans souci (limite GitHub = 100 Mo/fichier).
> `.gitignore` exclut déjà `node_modules`, les caches et `.env`.

Ensuite, pour mettre à jour le repo : `git add -A && git commit -m "..." && git push`.

---

## 2. Préparer le VPS (en root)

```bash
apt update && apt upgrade -y
apt install -y git curl ufw

# Node.js 20 LTS
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs
node -v   # doit afficher v20.x

# Utilisateur de service dédié
adduser --system --group --home /opt/valotiz valotiz
mkdir -p /opt/valotiz
```

## 3. Cloner le repo sur le VPS

```bash
git clone https://github.com/<TON-PSEUDO>/valotiz.git /opt/valotiz/app
chown -R valotiz:valotiz /opt/valotiz
```

> **Repo privé ?** Le clone demandera une authentification. Deux options simples :
> - **Token** : `git clone https://<TON-PSEUDO>:<TON_TOKEN_GITHUB>@github.com/<TON-PSEUDO>/valotiz.git /opt/valotiz/app`
>   (crée un *Personal Access Token* « repo:read » sur GitHub).
> - **Clé SSH de déploiement** : `ssh-keygen -t ed25519 -C valotiz`, ajoute la clé publique en *Deploy key* sur le repo,
>   puis `git clone git@github.com:<TON-PSEUDO>/valotiz.git /opt/valotiz/app`.

---

## Option A — HTTP direct par IP (rapide, sans domaine)

Les joueurs iront sur `http://IP_DU_VPS:8090`.

```bash
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

cp /opt/valotiz/app/deploy/valotiz-ws.service /etc/systemd/system/
systemctl daemon-reload && systemctl enable --now valotiz-ws

cp /opt/valotiz/app/deploy/nginx-valotiz.conf /etc/nginx/sites-available/valotiz
nano /etc/nginx/sites-available/valotiz          # mets ton domaine (server_name)
ln -s /etc/nginx/sites-available/valotiz /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw --force enable

certbot --nginx -d valotiz.ton-domaine.com       # fais pointer le DNS A -> IP du VPS avant
```

→ Ouvre `https://valotiz.ton-domaine.com`. Le client passe tout seul en `wss://.../ws`.
(En option B, laisse le port 8091 fermé au public : nginx y accède en local.)

---

## 4. Mettre à jour plus tard (git)

**Le plus simple — une commande depuis ta machine** (push + pull + restart) :

```bash
VPS=root@IP_DU_VPS ./deploy/deploy.sh "mon message de commit"
```

**Ou à la main.** Sur ta machine :

```bash
git add -A && git commit -m "maj" && git push
```

Puis sur le VPS :

```bash
/opt/valotiz/app/deploy/update.sh        # git pull + chown + restart des services
```

(équivaut à : `cd /opt/valotiz/app && git pull && chown -R valotiz:valotiz . && systemctl restart valotiz-ws valotiz-web`)

---

## Logs / dépannage

```bash
journalctl -u valotiz-ws  -f      # serveur temps réel
journalctl -u valotiz-web -f      # serveur web (option A)
systemctl restart valotiz-ws      # redémarrer
```

- Port WS configurable : `Environment=WS_PORT=9000` dans le service (et `proxy_pass ...:9000` côté nginx).
- Vérifie que les ports du cloud provider (Security Group / pare-feu externe) sont ouverts : 22, 80, 443, et 8090/8091 en option A.
- `git pull` refusé pour « local changes » ? Tu as modifié un fichier sur le VPS : `git checkout -- .` puis relance `update.sh`.
