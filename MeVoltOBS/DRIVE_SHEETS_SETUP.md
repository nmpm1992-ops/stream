## Drive / Spritesheet (3 ficheiros: CHAT / LOGS / WINNERS)

O overlay já envia batches para o servidor em `POST /drive/append`.

Requisito: **não usar APIs externas do Google** e **não guardar registos em JSONL**.  
Solução:
- O servidor mantém um **JSON “DB”** local (para ler/escrever como “database”).
- O servidor gera **3 ficheiros spritesheet (imagem)** na pasta do Drive:
  - `CHAT.ppm`
  - `LOGS.ppm`
  - `WINNERS.ppm`

> A spritesheet é um ficheiro de imagem **PPM (P6)** onde os registos são empacotados em bytes RGB (não é JSON).

### 1) Definir a pasta do Google Drive (onde queres os ficheiros)
Define a env `DRIVE_SYNC_DIR` para a pasta sincronizada do Drive, por exemplo:
- `DRIVE_SYNC_DIR=H:/O meu disco/MeVoltOBS`

Se não definires, o default é:
- `MeVoltOBS/DriveSync` (dentro do repo)

### 2) (Opcional) Definir onde fica o “DB” JSON
Por default o DB fica em:
- `MeVoltOBS/drive_db.json`

Podes mudar com:
- `DRIVE_DB_PATH=C:/.../MeVoltOBS/drive_db.json`

### Como validar
Depois de correr `npm start`:
- Abre `GET /drive/bootstrap` (deve responder `ok: true`)
- Deixa o overlay correr (ele envia batches para `POST /drive/append`)
- Confirma que na pasta `DRIVE_SYNC_DIR` aparecem:
  - `CHAT.ppm`, `LOGS.ppm`, `WINNERS.ppm`

Na resposta de `/drive/append` vais ver:
- `"spritesheets": { "chats": {...}, "logs": {...}, "winners": {...} }`

